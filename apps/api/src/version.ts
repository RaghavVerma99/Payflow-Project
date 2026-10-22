import path from "node:path";
import { fileURLToPath } from "node:url";

export const API_VERSION = "1.0.0";

export const API_TITLE = "PayFlow API";

export const API_DESCRIPTION = [
  "A payment processing simulator with the mechanics of a production system:",
  "idempotent writes, an explicit state machine, asynchronous processing with",
  "leases and retries, deterministic reconciliation of uncertain outcomes,",
  "double-entry accounting, tokenized payment methods, signed webhook",
  "delivery, balance-bounded payouts, disputes, and reporting.",
  "",
  "**No real card data is accepted and no real money moves.**",
  "",
  "Start with `GET /v1` for a machine-readable description of this deployment:",
  "available resources, simulator scenarios, webhook event types, error codes,",
  "and limits. Every response carries `x-request-id`; rate limit headers are",
  "exposed as `x-ratelimit-limit`, `x-ratelimit-remaining` and",
  "`x-ratelimit-reset`.",
].join("\n");

export const API_TAGS = [
  {
    name: "Payments",
    description:
      "Create, inspect, and cancel payments. Creation is idempotent when an `Idempotency-Key` header is sent.",
  },
  {
    name: "Refunds",
    description:
      "Refund settled payments. Capacity is reserved atomically, so concurrent refunds can never exceed the original amount.",
  },
  {
    name: "Payment methods",
    description:
      "Tokenized instruments. Only display metadata is stored; a card number is never accepted.",
  },
  {
    name: "Treasury",
    description:
      "Payouts that move collected funds out of the merchant balance, and disputes that reverse a settled charge.",
  },
  {
    name: "Webhooks",
    description:
      "Event delivery. Events are written transactionally, signed with HMAC-SHA256, and retried until they land.",
  },
  {
    name: "Ledger",
    description:
      "Double-entry accounts and posted journals. Balances are derived from immutable entries.",
  },
  {
    name: "Analytics",
    description:
      "Dashboard aggregates, daily volume, payment reports, and settlement summaries.",
  },
  {
    name: "Merchants",
    description: "The authenticated merchant, and management of its API keys.",
  },
  {
    name: "System",
    description: "Health, deployment capabilities, and development utilities.",
  },
];

export function resolveDocsRoot(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
  );
}
