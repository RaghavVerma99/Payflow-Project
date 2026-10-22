import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  OUTCOME_DISTRIBUTIONS,
  PAYMENT_METHOD_TYPES,
  SCENARIOS,
  WEBHOOK_EVENT_TYPES,
} from "../domain";
import { API_VERSION } from "../version";

const CapabilitiesSchema = z.object({
  object: z.literal("capabilities"),
  api_version: z.string(),
  environment: z.string(),
  merchant: z.object({ id: z.string(), name: z.string() }),
  resources: z.array(
    z.object({
      name: z.string(),
      summary: z.string(),
      endpoints: z.array(z.string()),
    }),
  ),
  simulator: z.object({
    scenarios: z.array(z.string()),
    outcome_distributions: z.record(z.string(), z.unknown()),
    payment_method_types: z.array(z.string()),
  }),
  webhooks: z.object({
    event_types: z.array(z.string()),
    signature_header: z.string(),
    signature_scheme: z.string(),
  }),
  limits: z.object({
    max_amount_minor: z.number().int(),
    default_page_size: z.number().int(),
    max_page_size: z.number().int(),
    rate_limit_per_minute: z.number().int(),
    idempotency_ttl_hours: z.number().int(),
    max_job_attempts: z.number().int(),
  }),
  error_codes: z.array(z.string()),
});

const RESOURCES = [
  {
    name: "payments",
    summary: "Idempotent payment creation with an explicit state machine.",
    endpoints: [
      "POST /v1/payments",
      "GET /v1/payments",
      "GET /v1/payments/{id}",
      "POST /v1/payments/{id}/cancel",
      "GET /v1/payments/{id}/refunds",
    ],
  },
  {
    name: "refunds",
    summary: "Refunds with atomically reserved capacity.",
    endpoints: [
      "POST /v1/refunds",
      "GET /v1/refunds",
      "GET /v1/refunds/{id}",
      "POST /v1/refunds/{id}/cancel",
    ],
  },
  {
    name: "payment_methods",
    summary: "Tokenized instruments. No card number is ever accepted.",
    endpoints: [
      "POST /v1/payment_methods",
      "GET /v1/payment_methods",
      "GET /v1/payment_methods/{id}",
      "POST /v1/payment_methods/{id}/disable",
    ],
  },
  {
    name: "payouts",
    summary: "Move collected funds out of the merchant balance.",
    endpoints: ["POST /v1/payouts", "GET /v1/payouts", "GET /v1/payouts/{id}"],
  },
  {
    name: "disputes",
    summary: "Open and resolve disputes against settled payments.",
    endpoints: [
      "POST /v1/disputes",
      "GET /v1/disputes",
      "GET /v1/disputes/{id}",
      "POST /v1/disputes/{id}/resolve",
    ],
  },
  {
    name: "webhooks",
    summary: "Transactional outbox, signed delivery, delivery log.",
    endpoints: [
      "POST /v1/webhook_endpoints",
      "GET /v1/webhook_endpoints",
      "POST /v1/webhook_endpoints/{id}/disable",
      "GET /v1/webhook_events",
      "GET /v1/webhook_events/{id}",
      "GET /v1/webhook_deliveries",
    ],
  },
  {
    name: "api_keys",
    summary: "Issue, list, and revoke merchant API keys.",
    endpoints: [
      "POST /v1/api_keys",
      "GET /v1/api_keys",
      "POST /v1/api_keys/{id}/revoke",
    ],
  },
  {
    name: "ledger",
    summary: "Accounts, trial balance, and posted journals.",
    endpoints: ["GET /v1/accounts", "GET /v1/ledger/journals"],
  },
  {
    name: "analytics",
    summary: "Aggregates, daily volume, and reports.",
    endpoints: [
      "GET /v1/stats/overview",
      "GET /v1/stats/timeseries",
      "GET /v1/reports/payments",
      "GET /v1/reports/settlement",
    ],
  },
];

const ERROR_CODES = [
  "unauthorized",
  "not_found",
  "validation_error",
  "invalid_request",
  "invalid_cursor",
  "invalid_scenario",
  "invalid_payment_method",
  "invalid_webhook_url",
  "unsupported_currency",
  "idempotency_key_reused",
  "idempotency_in_progress",
  "payment_not_refundable",
  "payment_not_cancelable",
  "refund_not_cancelable",
  "refund_exceeds_remaining",
  "payment_method_not_active",
  "payment_not_disputable",
  "dispute_not_open",
  "insufficient_balance",
  "invalid_state_transition",
  "simulator_controls_disabled",
  "internal_error",
];

export const metaRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1",
    {
      preHandler: [app.authenticate],
      schema: {
        operationId: "getCapabilities",
        tags: ["System"],
        summary: "Deployment capabilities",
        description:
          "A machine-readable description of this deployment: available resources, simulator scenarios, webhook event types, error codes, and limits. Point an SDK generator or a client bootstrapper at this document.",
        response: { 200: CapabilitiesSchema },
      },
    },
    async (request) => {
      return {
        object: "capabilities" as const,
        api_version: API_VERSION,
        environment: app.config.env,
        merchant: {
          id: request.merchant.id,
          name: request.merchant.name,
        },
        resources: RESOURCES,
        simulator: {
          scenarios: [...SCENARIOS],
          outcome_distributions: OUTCOME_DISTRIBUTIONS,
          payment_method_types: [...PAYMENT_METHOD_TYPES],
        },
        webhooks: {
          event_types: [...WEBHOOK_EVENT_TYPES],
          signature_header: "x-payflow-signature",
          signature_scheme:
            "t=<unix-seconds>,v1=hmac_sha256(secret, `<timestamp>.<body>`)",
        },
        limits: {
          max_amount_minor: 1_000_000_000,
          default_page_size: app.config.defaultPageSize,
          max_page_size: app.config.maxPageSize,
          rate_limit_per_minute: app.config.rateLimitMax,
          idempotency_ttl_hours: app.config.idempotencyTtlHours,
          max_job_attempts: app.config.maxJobAttempts,
        },
        error_codes: ERROR_CODES,
      };
    },
  );
};
