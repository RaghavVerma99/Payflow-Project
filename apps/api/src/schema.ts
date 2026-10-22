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
  name: text("name"),
  revokedAt: text("revoked_at"),
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at").notNull(),
});

export const paymentMethods = sqliteTable("payment_methods", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id").notNull(),
  type: text("type").notNull(),
  label: text("label").notNull(),
  last4: text("last4"),
  network: text("network"),
  expiryMonth: integer("expiry_month"),
  expiryYear: integer("expiry_year"),
  status: text("status").notNull().default("active"),
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
  paymentMethodId: text("payment_method_id"),
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

export const webhookEndpoints = sqliteTable("webhook_endpoints", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id").notNull(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
});

export const webhookEvents = sqliteTable("webhook_events", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id").notNull(),
  type: text("type").notNull(),
  payload: text("payload").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: text("next_attempt_at").notNull(),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const webhookDeliveries = sqliteTable("webhook_deliveries", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  endpointId: text("endpoint_id").notNull(),
  merchantId: text("merchant_id").notNull(),
  attempt: integer("attempt").notNull(),
  status: text("status").notNull(),
  responseStatus: integer("response_status"),
  responseBody: text("response_body"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
});

export const payouts = sqliteTable("payouts", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull().default("INR"),
  destination: text("destination").notNull(),
  status: text("status").notNull().default("pending"),
  failureCode: text("failure_code"),
  processorReference: text("processor_reference"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const disputes = sqliteTable("disputes", {
  id: text("id").primaryKey(),
  paymentId: text("payment_id").notNull(),
  merchantId: text("merchant_id").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"),
  note: text("note"),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
});

export const devSink = sqliteTable("dev_sink", {
  id: text("id").primaryKey(),
  token: text("token").notNull(),
  eventId: text("event_id"),
  eventType: text("event_type"),
  body: text("body").notNull(),
  signature: text("signature"),
  receivedAt: text("received_at").notNull(),
});

export type PaymentRow = typeof payments.$inferSelect;
export type PaymentAttemptRow = typeof paymentAttempts.$inferSelect;
export type PaymentEventRow = typeof paymentEvents.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type AccountRow = typeof accounts.$inferSelect;
export type RefundRow = typeof refunds.$inferSelect;
export type IdempotencyRow = typeof idempotencyRecords.$inferSelect;
export type PaymentMethodRow = typeof paymentMethods.$inferSelect;
export type WebhookEndpointRow = typeof webhookEndpoints.$inferSelect;
export type WebhookEventRow = typeof webhookEvents.$inferSelect;
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
export type PayoutRow = typeof payouts.$inferSelect;
export type DisputeRow = typeof disputes.$inferSelect;
