import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema";
import { SCHEMA_SQL } from "./schema-sql";

export type Db = BetterSQLite3Database<typeof schema>;

export interface DbHandle {
  db: Db;
  sqlite: Database.Database;
  close: () => void;
}

function migrateRefundStatus(sqlite: Database.Database): void {
  const table = sqlite
    .prepare(
      "select sql from sqlite_master where type = 'table' and name = 'refunds'",
    )
    .get() as { sql: string } | undefined;

  if (!table || table.sql.includes("'unknown'")) return;

  try {
    sqlite.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE refunds_migrated (
        id TEXT PRIMARY KEY,
        payment_id TEXT NOT NULL REFERENCES payments(id),
        merchant_id TEXT NOT NULL REFERENCES merchants(id),
        amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
        currency TEXT NOT NULL DEFAULT 'INR',
        status TEXT NOT NULL DEFAULT 'reserved'
          CHECK (status IN ('reserved','processing','succeeded','failed','canceled','unknown')),
        reason TEXT,
        failure_code TEXT,
        processor_reference TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO refunds_migrated (
        id, payment_id, merchant_id, amount_minor, currency, status, reason,
        failure_code, processor_reference, created_at, updated_at
      )
      SELECT
        id, payment_id, merchant_id, amount_minor, currency, status, reason,
        failure_code, processor_reference, created_at, updated_at
      FROM refunds;
      DROP TABLE refunds;
      ALTER TABLE refunds_migrated RENAME TO refunds;
      CREATE INDEX IF NOT EXISTS ix_refunds_payment_status ON refunds(payment_id, status);
      CREATE INDEX IF NOT EXISTS ix_refunds_merchant ON refunds(merchant_id, created_at);
      COMMIT;
    `);
  } catch (error) {
    try {
      sqlite.exec("ROLLBACK;");
    } catch {}
    throw error;
  }
}

function tableColumns(
  sqlite: Database.Database,
  table: string,
): string[] {
  return (
    sqlite.prepare(`pragma table_info(${table})`).all() as {
      name: string;
    }[]
  ).map((row) => row.name);
}

function addColumnIfMissing(
  sqlite: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  if (tableColumns(sqlite, table).includes(column)) return;
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
}

function migrateColumns(sqlite: Database.Database): void {
  addColumnIfMissing(sqlite, "api_keys", "name", "TEXT");
  addColumnIfMissing(sqlite, "api_keys", "last_used_at", "TEXT");
  addColumnIfMissing(
    sqlite,
    "payments",
    "payment_method_id",
    "TEXT REFERENCES payment_methods(id)",
  );
}

export function createDb(dbPath: string): DbHandle {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 30000");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.exec(SCHEMA_SQL);
  migrateRefundStatus(sqlite);
  migrateColumns(sqlite);

  const db = drizzle(sqlite, { schema });

  return {
    db,
    sqlite,
    close: () => sqlite.close(),
  };
}
