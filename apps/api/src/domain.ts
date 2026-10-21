import { createHash, randomBytes } from "node:crypto";

export const PAYMENT_STATUSES = [
  "created",
  "processing",
  "succeeded",
  "failed",
  "canceled",
  "unknown",
  "partially_refunded",
  "refunded",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const REFUND_STATUSES = [
  "reserved",
  "processing",
  "succeeded",
  "failed",
  "canceled",
  "unknown",
] as const;

export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const PAYMENT_METHOD_TYPES = ["card", "upi", "bank", "wallet"] as const;

export type PaymentMethodType = (typeof PAYMENT_METHOD_TYPES)[number];

export const PAYOUT_STATUSES = [
  "pending",
  "processing",
  "paid",
  "failed",
  "unknown",
] as const;

export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const DISPUTE_STATUSES = ["open", "won", "lost"] as const;

export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const WEBHOOK_EVENT_TYPES = [
  "payment.created",
  "payment.succeeded",
  "payment.failed",
  "payment.canceled",
  "payment.unknown",
  "refund.succeeded",
  "refund.failed",
  "refund.canceled",
  "payout.paid",
  "payout.failed",
  "dispute.opened",
  "dispute.won",
  "dispute.lost",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

const ALLOWED_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  created: ["processing", "canceled"],
  processing: ["succeeded", "failed", "unknown"],
  unknown: ["succeeded", "failed"],
  succeeded: ["partially_refunded", "refunded"],
  partially_refunded: ["partially_refunded", "refunded"],
  failed: [],
  canceled: [],
  refunded: [],
};

export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const errors = {
  unauthorized: () =>
    new AppError("unauthorized", 401, "Missing or invalid API key."),
  notFound: (resource = "Resource") =>
    new AppError("not_found", 404, `${resource} not found.`),
  invalid: (message: string, code = "invalid_request") =>
    new AppError(code, 400, message),
  conflict: (message: string, code = "conflict") =>
    new AppError(code, 409, message),
  idempotencyMismatch: () =>
    new AppError(
      "idempotency_key_reused",
      409,
      "This idempotency key was already used with a different request body.",
    ),
  idempotencyInProgress: () =>
    new AppError(
      "idempotency_in_progress",
      409,
      "A request with this idempotency key is still in progress.",
    ),
  refundCapacity: () =>
    new AppError(
      "refund_exceeds_remaining",
      409,
      "Refund amount exceeds the remaining refundable balance.",
    ),
  notRefundable: () =>
    new AppError(
      "payment_not_refundable",
      409,
      "Only succeeded payments can be refunded.",
    ),
  refundNotCancelable: () =>
    new AppError(
      "refund_not_cancelable",
      409,
      "Only reserved refunds can be canceled.",
    ),
  paymentMethodInactive: () =>
    new AppError(
      "payment_method_not_active",
      409,
      "This payment method is disabled.",
    ),
  insufficientBalance: (message: string) =>
    new AppError("insufficient_balance", 409, message),
  disputeNotOpen: () =>
    new AppError(
      "dispute_not_open",
      409,
      "Only open disputes can be resolved.",
    ),
  paymentNotDisputable: () =>
    new AppError(
      "payment_not_disputable",
      409,
      "Only settled payments can be disputed.",
    ),
  invalidWebhookUrl: (message: string) =>
    new AppError("invalid_webhook_url", 400, message),
  simulatorDisabled: () =>
    new AppError(
      "simulator_controls_disabled",
      403,
      "Simulator scenario controls are disabled in this environment.",
    ),
};

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

export function addHours(iso: string, hours: number): string {
  return addSeconds(iso, hours * 3600);
}

export function backoffSeconds(attempts: number): number {
  return Math.min(300, 2 ** attempts * 2);
}

export function encodeCursor(row: { createdAt: string; id: string }): string {
  return Buffer.from(`${row.createdAt}|${row.id}`, "utf8").toString(
    "base64url",
  );
}

export function decodeCursor(cursor: string): {
  createdAt: string;
  id: string;
} {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw errors.invalid("Invalid pagination cursor.");
  }
  const [createdAt, id] = decoded.split("|");
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) {
    throw errors.invalid("Invalid pagination cursor.");
  }
  return { createdAt, id };
}

export function assertTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (from === to) return;
  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    throw new AppError(
      "invalid_state_transition",
      409,
      `Cannot move payment from ${from} to ${to}.`,
    );
  }
}

export function formatMinor(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

export const SCENARIOS = [
  "approve",
  "decline",
  "timeout",
  "transient",
  "auto",
] as const;

export type Scenario = (typeof SCENARIOS)[number];

export function parseScenario(value: string | undefined | null): Scenario {
  if (!value) return "auto";
  if (!(SCENARIOS as readonly string[]).includes(value)) {
    throw errors.invalid(
      `Unknown simulator scenario. Expected one of: ${SCENARIOS.join(", ")}.`,
      "invalid_scenario",
    );
  }
  return value as Scenario;
}

export type SimulationOutcome = "succeeded" | "declined" | "timeout" | "error";

export interface SimulationResult {
  outcome: SimulationOutcome;
  reference: string;
  failureCode: string | null;
}

function hashToBucket(value: string): number {
  const digest = createHash("sha256").update(value).digest();
  return digest.readUInt32BE(0) % 100;
}

export function runSimulation(
  reference: string,
  scenario: Scenario,
  attemptNumber: number,
  methodType: PaymentMethodType = "card",
): SimulationResult {
  switch (scenario) {
    case "approve":
      return { outcome: "succeeded", reference, failureCode: null };
    case "decline":
      return {
        outcome: "declined",
        reference,
        failureCode: "card_declined",
      };
    case "timeout":
      return {
        outcome: "timeout",
        reference,
        failureCode: "processor_timeout",
      };
    case "transient":
      return attemptNumber <= 1
        ? {
            outcome: "error",
            reference,
            failureCode: "processor_unavailable",
          }
        : { outcome: "succeeded", reference, failureCode: null };
    case "auto":
    default: {
      const distribution = OUTCOME_DISTRIBUTIONS[methodType] ?? {
        success: 78,
        lookup: 16,
      };
      const bucket = hashToBucket(`${reference}:${methodType}`);
      if (bucket < distribution.success) {
        return { outcome: "succeeded", reference, failureCode: null };
      }
      if (bucket < distribution.success + distribution.lookup) {
        return actualLookup(reference);
      }
      return {
        outcome: "timeout",
        reference,
        failureCode: "processor_timeout",
      };
    }
  }
}

export const OUTCOME_DISTRIBUTIONS: Record<
  PaymentMethodType,
  { success: number; lookup: number }
> = {
  card: { success: 78, lookup: 16 },
  upi: { success: 92, lookup: 5 },
  bank: { success: 68, lookup: 22 },
  wallet: { success: 84, lookup: 11 },
};

function actualLookup(reference: string): SimulationResult {
  const bucket = hashToBucket(`lookup:${reference}`);
  return bucket < 80
    ? { outcome: "succeeded", reference, failureCode: null }
    : { outcome: "declined", reference, failureCode: "card_declined" };
}

export function lookupSimulation(reference: string): SimulationResult {
  return actualLookup(reference);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface Page<T> {
  data: T[];
  has_more: boolean;
  next_cursor: string | null;
}
