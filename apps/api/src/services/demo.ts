import { existsSync, readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { demoKeyPath } from "../config";
import type { Db } from "../db";
import { AppError } from "../domain";
import { seedDemo, seedPlatform } from "../seed";
import { resolveApiKey, type MerchantContextRow } from "./auth";

export interface DemoSession {
  apiKey: string;
  merchant: MerchantContextRow;
}

export interface DemoResetSummary {
  payments: number;
  refunds: number;
  methods: number;
  endpoints: number;
  disputes: number;
  payouts: number;
}

const BUSINESS_TABLES = [
  "dev_sink",
  "webhook_deliveries",
  "webhook_events",
  "webhook_endpoints",
  "ledger_entries",
  "ledger_transactions",
  "disputes",
  "refunds",
  "payouts",
  "payment_events",
  "payment_attempts",
  "payments",
  "payment_methods",
  "idempotency_records",
  "jobs",
  "accounts",
];

const LEDGER_DELETE_TRIGGERS = [
  "trg_ledger_entries_no_delete",
  "trg_ledger_tx_no_delete",
];

const LEDGER_TRIGGER_SQL = [
  `CREATE TRIGGER IF NOT EXISTS trg_ledger_entries_no_delete
   BEFORE DELETE ON ledger_entries
   BEGIN
     SELECT RAISE(ABORT, 'ledger entries are immutable');
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_ledger_tx_no_delete
   BEFORE DELETE ON ledger_transactions
   WHEN OLD.status = 'posted'
   BEGIN
     SELECT RAISE(ABORT, 'posted journals are immutable');
   END`,
];

export function loadDemoSession(
  db: Db,
  dbPath: string,
  pepper: string,
): DemoSession {
  const keyFile = demoKeyPath(dbPath);
  if (!existsSync(keyFile)) {
    throw new AppError(
      "demo_not_seeded",
      404,
      "No demo workspace found. Run `npm run seed` first.",
    );
  }

  let apiKey: string | undefined;
  try {
    apiKey = (JSON.parse(readFileSync(keyFile, "utf8")) as { api_key?: string })
      .api_key;
  } catch {
    apiKey = undefined;
  }

  if (!apiKey) {
    throw new AppError(
      "demo_not_seeded",
      404,
      "Demo key file is invalid. Re-run `npm run seed`.",
    );
  }

  const merchant = resolveApiKey(db, apiKey, pepper);
  if (!merchant) {
    throw new AppError(
      "demo_not_seeded",
      404,
      "The seeded demo key is no longer valid. Re-run `npm run seed`.",
    );
  }

  return { apiKey, merchant };
}

export function resetDemoWorkspace(
  db: Db,
  merchantId: string,
  options: { maxJobAttempts: number; port: number },
): DemoResetSummary {
  db.transaction(
    (tx) => {
      const t = tx as unknown as Db;
      for (const trigger of LEDGER_DELETE_TRIGGERS) {
        t.run(sql.raw(`drop trigger if exists ${trigger}`));
      }
      for (const table of BUSINESS_TABLES) {
        t.run(sql.raw(`delete from ${table}`));
      }
      for (const statement of LEDGER_TRIGGER_SQL) {
        t.run(sql.raw(statement));
      }
    },
    { behavior: "immediate" },
  );

  return {
    ...seedDemo(db, merchantId, options.maxJobAttempts),
    ...seedPlatform(db, merchantId, options.port),
  };
}
