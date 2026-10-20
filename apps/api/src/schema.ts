import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const merchants = sqliteTable("merchants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
});

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull(),
  revokedAt: text("revoked_at"),
  createdAt: text("created_at").notNull(),
});

export const payments = sqliteTable("payments", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull().default("INR"),
  status: text("status").notNull().default("created"),
  customerId: text("customer_id"),
  description: text("description"),
  failureCode: text("failure_code"),
  refundedMinor: integer("refunded_minor").notNull().default(0),
  refundReservedMinor: integer("refund_reserved_minor").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const paymentAttempts = sqliteTable("payment_attempts", {
  id: text("id").primaryKey(),
  paymentId: text("payment_id").notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  status: text("status").notNull().default("started"),
  processorReference: text("processor_reference").notNull(),
  failureCode: text("failure_code"),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
});

export const paymentEvents = sqliteTable("payment_events", {
  id: text("id").primaryKey(),
  paymentId: text("payment_id").notNull(),
  type: text("type").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  reason: text("reason"),
  createdAt: text("created_at").notNull(),
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  aggregateId: text("aggregate_id"),
  payload: text("payload").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  nextRunAt: text("next_run_at").notNull(),
  claimedBy: text("claimed_by"),
  leaseExpiresAt: text("lease_expires_at"),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const idempotencyRecords = sqliteTable("idempotency_records", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id").notNull(),
  operation: text("operation").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  status: text("status").notNull().default("in_progress"),
  resourceId: text("resource_id"),
  responseStatus: integer("response_status"),
  responseBody: text("response_body"),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id"),
  code: text("code").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  currency: text("currency").notNull().default("INR"),
  createdAt: text("created_at").notNull(),
});

export const ledgerTransactions = sqliteTable("ledger_transactions", {
  id: text("id").primaryKey(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  status: text("status").notNull().default("posted"),
  currency: text("currency").notNull().default("INR"),
  createdAt: text("created_at").notNull(),
  postedAt: text("posted_at"),
});

export const ledgerEntries = sqliteTable("ledger_entries", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id").notNull(),
  accountId: text("account_id").notNull(),
  direction: text("direction").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull().default("INR"),
  createdAt: text("created_at").notNull(),
});

export const refunds = sqliteTable("refunds", {
  id: text("id").primaryKey(),
  paymentId: text("payment_id").notNull(),
  merchantId: text("merchant_id").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull().default("INR"),
  status: text("status").notNull().default("reserved"),
  reason: text("reason"),
  failureCode: text("failure_code"),
  processorReference: text("processor_reference"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type MerchantRow = typeof merchants.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type PaymentAttemptRow = typeof paymentAttempts.$inferSelect;
export type PaymentEventRow = typeof paymentEvents.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type AccountRow = typeof accounts.$inferSelect;
export type LedgerTransactionRow = typeof ledgerTransactions.$inferSelect;
export type LedgerEntryRow = typeof ledgerEntries.$inferSelect;
export type RefundRow = typeof refunds.$inferSelect;
export type IdempotencyRow = typeof idempotencyRecords.$inferSelect;
