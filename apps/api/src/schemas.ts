import { z } from "zod";
import { PAYMENT_STATUSES, REFUND_STATUSES, SCENARIOS } from "./domain";

const ISODate = z.string();

export const PaymentSchema = z.object({
  object: z.literal("payment"),
  id: z.string(),
  status: z.enum(PAYMENT_STATUSES),
  amount_minor: z.number().int(),
  amount: z.string(),
  currency: z.string(),
  customer_id: z.string().nullable(),
  description: z.string().nullable(),
  failure_code: z.string().nullable(),
  refunded_minor: z.number().int(),
  refund_reserved_minor: z.number().int(),
  refundable_minor: z.number().int(),
  created_at: ISODate,
  updated_at: ISODate,
});

export const PaymentAttemptSchema = z.object({
  id: z.string(),
  attempt_number: z.number().int(),
  status: z.string(),
  processor_reference: z.string(),
  failure_code: z.string().nullable(),
  started_at: ISODate,
  finished_at: ISODate.nullable(),
});

export const PaymentEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  from_status: z.string().nullable(),
  to_status: z.string(),
  reason: z.string().nullable(),
  created_at: ISODate,
});

export const PaymentDetailSchema = PaymentSchema.extend({
  attempts: z.array(PaymentAttemptSchema),
  events: z.array(PaymentEventSchema),
});

export const RefundSchema = z.object({
  object: z.literal("refund"),
  id: z.string(),
  payment_id: z.string(),
  status: z.enum(REFUND_STATUSES),
  amount_minor: z.number().int(),
  amount: z.string(),
  currency: z.string(),
  reason: z.string().nullable(),
  failure_code: z.string().nullable(),
  created_at: ISODate,
  updated_at: ISODate,
});

export const PaymentListSchema = z.object({
  data: z.array(PaymentSchema),
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
});

export const RefundListSchema = z.object({
  data: z.array(RefundSchema),
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
});

export const AccountSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  kind: z.string(),
  currency: z.string(),
  debits_minor: z.number().int(),
  credits_minor: z.number().int(),
  balance_minor: z.number().int(),
});

export const JournalEntrySchema = z.object({
  id: z.string(),
  account_id: z.string(),
  account_code: z.string(),
  account_name: z.string(),
  direction: z.enum(["debit", "credit"]),
  amount_minor: z.number().int(),
});

export const JournalSchema = z.object({
  id: z.string(),
  source_type: z.string(),
  source_id: z.string(),
  status: z.string(),
  currency: z.string(),
  created_at: ISODate,
  entries: z.array(JournalEntrySchema),
});

export const JournalListSchema = z.object({
  data: z.array(JournalSchema),
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
});

export const AccountsResponseSchema = z.object({
  data: z.array(AccountSchema),
  trial_balance: z.object({
    debits_minor: z.number().int(),
    credits_minor: z.number().int(),
    balanced: z.boolean(),
  }),
});

export const OverviewSchema = z.object({
  merchant: z.object({ id: z.string(), name: z.string() }),
  payments: z.object({
    total: z.number().int(),
    succeeded: z.number().int(),
    failed: z.number().int(),
    processing: z.number().int(),
    by_status: z.record(z.string(), z.number()),
    success_rate: z.number(),
  }),
  volume: z.object({
    gross_minor: z.number().int(),
    refunded_minor: z.number().int(),
    net_minor: z.number().int(),
  }),
  refunds: z.object({
    total: z.number().int(),
    succeeded: z.number().int(),
    by_status: z.record(z.string(), z.number()),
  }),
  ledger: z.object({
    balanced: z.boolean(),
    debits_minor: z.number().int(),
    credits_minor: z.number().int(),
    accounts: z.array(AccountSchema),
  }),
  jobs: z.record(z.string(), z.number()),
  recent_payments: z.array(PaymentSchema),
});

export const TimeseriesPointSchema = z.object({
  date: z.string(),
  payments: z.number().int(),
  succeeded: z.number().int(),
  failed: z.number().int(),
  volume_minor: z.number().int(),
});

export const TimeseriesSchema = z.object({
  days: z.number().int(),
  data: z.array(TimeseriesPointSchema),
});

export const MerchantSchema = z.object({
  object: z.literal("merchant"),
  id: z.string(),
  name: z.string(),
  environment: z.string(),
});

export const HealthSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  version: z.string(),
  environment: z.string(),
  checks: z.object({
    database: z.literal("ok"),
    worker: z.enum(["enabled", "disabled"]),
  }),
  queue_depth: z.number().int(),
});

export const CreatePaymentBody = z.object({
  amount_minor: z
    .number()
    .int()
    .positive()
    .max(1_000_000_000, "amount_minor exceeds the simulator limit"),
  currency: z.literal("INR").default("INR"),
  customer_id: z.string().min(1).max(120).nullish(),
  description: z.string().max(500).nullish(),
  simulator_scenario: z.enum(SCENARIOS).optional(),
});

export const CreateRefundBody = z.object({
  payment_id: z.string().min(1, "payment_id is required"),
  amount_minor: z.number().int().positive().nullish(),
  reason: z.string().max(500).nullish(),
  simulator_scenario: z.enum(SCENARIOS).optional(),
});

export const ListPaymentsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
  status: z.enum(PAYMENT_STATUSES).optional(),
});

export const ListRefundsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
  status: z.enum(REFUND_STATUSES).optional(),
  payment_id: z.string().optional(),
});

export const ListJournalsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

export const TimeseriesQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(14),
});

export const PaymentParams = z.object({ id: z.string().min(1) });
export const RefundParams = z.object({ id: z.string().min(1) });

export const DemoSessionSchema = z.object({
  api_key: z.string(),
  merchant: z.object({ id: z.string(), name: z.string() }),
  environment: z.string(),
});

export type CreatePaymentBodyType = z.infer<typeof CreatePaymentBody>;
export type CreateRefundBodyType = z.infer<typeof CreateRefundBody>;
