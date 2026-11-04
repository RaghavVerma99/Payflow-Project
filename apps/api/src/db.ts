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

  sqlite.exec(`
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
    `);
}

function tableColumns(sqlite: Database.Database, table: string): string[] {
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

interface Migration {
  version: number;
  apply: (sqlite: Database.Database) => void;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    apply(sqlite) {
      sqlite.exec(SCHEMA_SQL);
      migrateRefundStatus(sqlite);
      migrateColumns(sqlite);
    },
  },
  {
    version: 2,
    apply(sqlite) {
      for (const table of ["payments", "refunds", "payouts"]) {
        addColumnIfMissing(
          sqlite,
          table,
          "requires_attention",
          "INTEGER NOT NULL DEFAULT 0 CHECK (requires_attention IN (0,1))",
        );
        addColumnIfMissing(sqlite, table, "attention_reason", "TEXT");
      }

      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS ix_payments_attention ON payments(merchant_id, requires_attention);
        CREATE INDEX IF NOT EXISTS ix_refunds_attention ON refunds(merchant_id, requires_attention);
        CREATE INDEX IF NOT EXISTS ix_payouts_attention ON payouts(merchant_id, requires_attention);
      `);

      for (const table of ["payments", "refunds", "payouts"]) {
        sqlite
          .prepare(
            `UPDATE ${table}
             SET requires_attention = 1,
                 attention_reason = COALESCE(attention_reason, 'A processing job exhausted its retries.')
             WHERE EXISTS (
               SELECT 1 FROM jobs
               WHERE jobs.aggregate_id = ${table}.id AND jobs.status = 'dead'
             )`,
          )
          .run();
      }
    },
  },
];

export function createDb(dbPath: string): DbHandle {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 30000");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );`);

  const appliedVersion = sqlite
    .prepare(
      "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
    )
    .get() as { version: number };

  const latestVersion = MIGRATIONS.at(-1)?.version ?? 0;
  if (appliedVersion.version > latestVersion) {
    sqlite.close();
    throw new Error(
      `Database schema version ${appliedVersion.version} is newer than this application supports (${latestVersion}).`,
    );
  }

  try {
    for (const migration of MIGRATIONS) {
      if (migration.version <= appliedVersion.version) continue;
      sqlite
        .transaction(() => {
          migration.apply(sqlite);
          sqlite
            .prepare(
              "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
            )
            .run(migration.version, new Date().toISOString());
        })
        .immediate();
    }
  } catch (error) {
    sqlite.close();
    throw error;
  }

  const db = drizzle(sqlite, { schema });

  return {
    db,
    sqlite,
    close: () => sqlite.close(),
  };
}
