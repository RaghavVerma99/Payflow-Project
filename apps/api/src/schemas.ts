import { z } from "zod";
import {
  DISPUTE_STATUSES,
  PAYMENT_METHOD_TYPES,
  PAYMENT_STATUSES,
  PAYOUT_STATUSES,
  REFUND_STATUSES,
  SCENARIOS,
} from "./domain";

const ISODate = z.string();

export const PaymentMethodSchema = z
  .object({
    object: z.literal("payment_method"),
    id: z.string(),
    type: z.enum(PAYMENT_METHOD_TYPES),
    label: z.string(),
    last4: z.string().nullable(),
    network: z.string().nullable(),
    expiry_month: z.number().int().nullable(),
    expiry_year: z.number().int().nullable(),
    status: z.string(),
    created_at: ISODate,
  })
  .meta({
    description:
      "A tokenized instrument. Only display metadata is stored; a card number is never accepted.",
    examples: [
      {
        object: "payment_method",
        id: "pm_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
        type: "card",
        label: "Acme corporate card",
        last4: "4242",
        network: "visa",
        expiry_month: 11,
        expiry_year: 2030,
        status: "active",
        created_at: "2026-10-21T08:30:00.000Z",
      },
    ],
  });

export const PayoutSchema = z
  .object({
    object: z.literal("payout"),
    id: z.string(),
    status: z.enum(PAYOUT_STATUSES),
    amount_minor: z.number().int(),
    amount: z.string(),
    currency: z.string(),
    destination: z.string(),
    failure_code: z.string().nullable(),
    created_at: ISODate,
    updated_at: ISODate,
  })
  .meta({
    description:
      "A payout of collected funds. The amount is bounded by the merchant payable balance.",
    examples: [
      {
        object: "payout",
        id: "po_5e4d3c2b1a09f8e7d6c5b4a39281706f5",
        status: "paid",
        amount_minor: 5000,
        amount: "50.00",
        currency: "INR",
        destination: "bank://hdfc-7788",
        failure_code: null,
        created_at: "2026-10-21T09:10:00.000Z",
        updated_at: "2026-10-21T09:10:00.318Z",
      },
    ],
  });

export const DisputeSchema = z
  .object({
    object: z.literal("dispute"),
    id: z.string(),
    payment_id: z.string(),
    status: z.enum(DISPUTE_STATUSES),
    amount_minor: z.number().int(),
    amount: z.string(),
    reason: z.string(),
    note: z.string().nullable(),
    created_at: ISODate,
    resolved_at: z.string().nullable(),
  })
  .meta({
    description:
      "A dispute against a settled payment. Resolving it as lost posts a reversing journal.",
    examples: [
      {
        object: "dispute",
        id: "dp_0f9e8d7c6b5a493827160f5e4d3c2b1a",
        payment_id: "pay_2f8c1a9d4e6b7c8d9e0f1a2b3c4d5e6f",
        status: "open",
        amount_minor: 2000,
        amount: "20.00",
        reason: "Customer claims the order never arrived",
        note: "Awaiting carrier evidence",
        created_at: "2026-10-21T09:20:00.000Z",
        resolved_at: null,
      },
    ],
  });

export const WebhookEndpointSchema = z.object({
  object: z.literal("webhook_endpoint"),
  id: z.string(),
  url: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  created_at: ISODate,
});

export const WebhookEventSchema = z.object({
  object: z.literal("webhook_event"),
  id: z.string(),
  type: z.string(),
  status: z.string(),
  attempts: z.number().int(),
  last_error: z.string().nullable(),
  payload: z.unknown(),
  created_at: ISODate,
  updated_at: ISODate,
});

export const WebhookDeliverySchema = z.object({
  object: z.literal("webhook_delivery"),
  id: z.string(),
  event_id: z.string(),
  endpoint_id: z.string(),
  attempt: z.number().int(),
  status: z.string(),
  response_status: z.number().int().nullable(),
  response_body: z.string().nullable(),
  error: z.string().nullable(),
  created_at: ISODate,
});

export const ApiKeySchema = z.object({
  object: z.literal("api_key"),
  id: z.string(),
  prefix: z.string(),
  name: z.string().nullable(),
  created_at: ISODate,
  revoked_at: z.string().nullable(),
  last_used_at: z.string().nullable(),
  status: z.enum(["active", "revoked"]),
});

export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
      request_id: z.string(),
    }),
  })
  .meta({
    description:
      "Every failure uses this envelope. `code` is stable and machine-readable; `request_id` correlates the failure with the server logs.",
    examples: [
      {
        error: {
          code: "idempotency_key_reused",
          message:
            "This idempotency key was already used with a different request body.",
          request_id: "req_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
        },
      },
    ],
  });

export const ERROR_RESPONSES = {
  400: ErrorSchema,
  401: ErrorSchema,
  403: ErrorSchema,
  404: ErrorSchema,
  409: ErrorSchema,
  429: ErrorSchema,
  500: ErrorSchema,
};

export const PaymentMethodListSchema = z.object({
  data: z.array(PaymentMethodSchema),
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
});

export const PayoutListSchema = z.object({
  data: z.array(PayoutSchema),
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
});

export const DisputeListSchema = z.object({
  data: z.array(DisputeSchema),
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
});

export const WebhookEventListSchema = z.object({
  data: z.array(WebhookEventSchema),
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
});

export const WebhookDeliveryListSchema = z.object({
  data: z.array(WebhookDeliverySchema),
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
});

export const WebhookEndpointListSchema = z.object({
  data: z.array(WebhookEndpointSchema),
});

export const ApiKeyListSchema = z.object({
  data: z.array(ApiKeySchema),
});

export const PaymentSchema = z
  .object({
    object: z.literal("payment"),
    id: z.string(),
    status: z.enum(PAYMENT_STATUSES),
    amount_minor: z.number().int(),
    amount: z.string(),
    currency: z.string(),
    customer_id: z.string().nullable(),
    description: z.string().nullable(),
    payment_method_id: z.string().nullable(),
    failure_code: z.string().nullable(),
    refunded_minor: z.number().int(),
    refund_reserved_minor: z.number().int(),
    refundable_minor: z.number().int(),
    created_at: ISODate,
    updated_at: ISODate,
  })
  .meta({
    description:
      "A payment. Amounts are integer minor units; `amount` is the derived display string.",
    examples: [
      {
        object: "payment",
        id: "pay_2f8c1a9d4e6b7c8d9e0f1a2b3c4d5e6f",
        status: "succeeded",
        amount_minor: 24900,
        amount: "249.00",
        currency: "INR",
        customer_id: "cus_demo_101",
        description: "Order #1042",
        payment_method_id: "pm_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
        failure_code: null,
        refunded_minor: 0,
        refund_reserved_minor: 0,
        refundable_minor: 24900,
        created_at: "2026-10-21T09:00:00.000Z",
        updated_at: "2026-10-21T09:00:01.482Z",
      },
    ],
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

export const RefundSchema = z
  .object({
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
  })
  .meta({
    description:
      "A refund. Capacity is reserved when the refund is created and consumed when it settles.",
    examples: [
      {
        object: "refund",
        id: "ref_9f8e7d6c5b4a39281706f5e4d3c2b1a09",
        payment_id: "pay_2f8c1a9d4e6b7c8d9e0f1a2b3c4d5e6f",
        status: "succeeded",
        amount_minor: 5000,
        amount: "50.00",
        currency: "INR",
        reason: "damaged item",
        failure_code: null,
        created_at: "2026-10-21T09:05:00.000Z",
        updated_at: "2026-10-21T09:05:00.612Z",
      },
    ],
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
  payment_method_id: z.string().min(1).max(120).nullish(),
  simulator_scenario: z.enum(SCENARIOS).optional(),
});

export const CreatePaymentMethodBody = z.object({
  type: z.enum(PAYMENT_METHOD_TYPES),
  label: z.string().min(1).max(80),
  last4: z.string().max(4).nullish(),
  network: z.string().max(40).nullish(),
  expiry_month: z.number().int().min(1).max(12).nullish(),
  expiry_year: z.number().int().min(2000).max(2100).nullish(),
});

export const CreatePayoutBody = z.object({
  amount_minor: z
    .number()
    .int()
    .positive()
    .max(1_000_000_000, "amount_minor exceeds the simulator limit"),
  destination: z.string().min(1).max(120),
  simulator_scenario: z.enum(SCENARIOS).optional(),
});

export const CreateDisputeBody = z.object({
  payment_id: z.string().min(1, "payment_id is required"),
  amount_minor: z.number().int().positive().nullish(),
  reason: z.string().min(1).max(200),
  note: z.string().max(500).nullish(),
});

export const ResolveDisputeBody = z.object({
  outcome: z.enum(["won", "lost"]),
  note: z.string().max(500).nullish(),
});

export const CreateWebhookEndpointBody = z.object({
  url: z.string().min(1).max(500),
  description: z.string().max(200).nullish(),
});

export const CreateApiKeyBody = z.object({
  name: z.string().min(1).max(80).nullish(),
});

export const CreateRefundBody = z.object({
  payment_id: z.string().min(1, "payment_id is required"),
  amount_minor: z.number().int().positive().nullish(),
  reason: z.string().max(500).nullish(),
  simulator_scenario: z.enum(SCENARIOS).optional(),
});

export const ListPaymentsQuery = (defaultLimit: number, maxLimit: number) =>
  z.object({
    limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit),
    cursor: z.string().optional(),
    status: z.enum(PAYMENT_STATUSES).optional(),
  });

export const ListMethodQuery = (defaultLimit: number, maxLimit: number) =>
  z.object({
    limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit),
    cursor: z.string().optional(),
    status: z.enum(["active", "disabled"]).optional(),
  });

export const ListPayoutQuery = (defaultLimit: number, maxLimit: number) =>
  z.object({
    limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit),
    cursor: z.string().optional(),
    status: z.enum(PAYOUT_STATUSES).optional(),
  });

export const ListDisputeQuery = (defaultLimit: number, maxLimit: number) =>
  z.object({
    limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit),
    cursor: z.string().optional(),
    status: z.enum(DISPUTE_STATUSES).optional(),
  });

export const ListWebhookEventQuery = (defaultLimit: number, maxLimit: number) =>
  z.object({
    limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit),
    cursor: z.string().optional(),
    status: z.enum(["pending", "delivered", "failed", "dead"]).optional(),
  });

export const ListRefundsQuery = (defaultLimit: number, maxLimit: number) =>
  z.object({
    limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit),
    cursor: z.string().optional(),
    status: z.enum(REFUND_STATUSES).optional(),
    payment_id: z.string().optional(),
  });

export const ListJournalsQuery = (defaultLimit: number, maxLimit: number) =>
  z.object({
    limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit),
    cursor: z.string().optional(),
  });

export const TimeseriesQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(14),
});

export const PaymentParams = z.object({ id: z.string().min(1) });
export const RefundParams = z.object({ id: z.string().min(1) });
export const PayoutParams = z.object({ id: z.string().min(1) });
export const DisputeParams = z.object({ id: z.string().min(1) });
export const MethodParams = z.object({ id: z.string().min(1) });
export const EndpointParams = z.object({ id: z.string().min(1) });
export const ApiKeyParams = z.object({ id: z.string().min(1) });

export const ReportQuery = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

export const SettlementQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});

export const DemoSessionSchema = z.object({
  api_key: z.string(),
  merchant: z.object({ id: z.string(), name: z.string() }),
  environment: z.string(),
});
