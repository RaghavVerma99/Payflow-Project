import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDb } from "./db";
import { SCHEMA_SQL } from "./schema-sql";

function legacySchemaSql(): string {
  return SCHEMA_SQL.split("\n")
    .filter(
      (line) =>
        !line.includes("requires_attention") &&
        !line.includes("attention_reason") &&
        !line.includes("_attention"),
    )
    .join("\n");
}

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("migrations", () => {
  it("adds attention columns and backfills resources with dead jobs", () => {
    const directory = mkdtempSync(join(tmpdir(), "payflow-migrations-"));
    cleanup = () => rmSync(directory, { recursive: true, force: true });
    const dbPath = join(directory, "payflow.db");
    const now = new Date().toISOString();

    const legacy = new Database(dbPath);
    legacy.pragma("foreign_keys = ON");
    legacy.exec(legacySchemaSql());
    legacy.exec(`CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );`);
    legacy
      .prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)",
      )
      .run(now);
    legacy
      .prepare(
        "INSERT INTO merchants (id, name, status, created_at) VALUES (?, ?, ?, ?)",
      )
      .run("mch_legacy", "Legacy Merchant", "active", now);
    legacy
      .prepare(
        `INSERT INTO payments (
          id, merchant_id, amount_minor, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("pay_legacy", "mch_legacy", 10_000, "processing", now, now);
    legacy
      .prepare(
        `INSERT INTO jobs (
          id, kind, aggregate_id, payload, status, next_run_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "job_legacy",
        "process_payment",
        "pay_legacy",
        "{}",
        "dead",
        now,
        now,
        now,
      );
    legacy.close();

    const handle = createDb(dbPath);
    try {
      const payment = handle.sqlite
        .prepare(
          "SELECT requires_attention, attention_reason FROM payments WHERE id = ?",
        )
        .get("pay_legacy") as {
        requires_attention: number;
        attention_reason: string | null;
      };

      expect(payment.requires_attention).toBe(1);
      expect(payment.attention_reason).toContain("exhausted");

      for (const table of ["payments", "refunds", "payouts"]) {
        const columns = (
          handle.sqlite.prepare(`pragma table_info(${table})`).all() as {
            name: string;
          }[]
        ).map((column) => column.name);
        expect(columns).toContain("requires_attention");
        expect(columns).toContain("attention_reason");
      }
    } finally {
      handle.close();
    }
  });
});
