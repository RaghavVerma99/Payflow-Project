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

export const TERMINAL_PAYMENT_STATUSES: ReadonlySet<PaymentStatus> = new Set([
  "succeeded",
  "failed",
  "canceled",
  "refunded",
  "partially_refunded",
]);

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

export function encodeCursor(row: { createdAt: string; id: string }): string {
  return Buffer.from(`${row.createdAt}|${row.id}`, "utf8").toString(
    "base64url",
  );
}

export function decodeCursor(cursor: string): { createdAt: string; id: string } {
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

export type SimulationOutcome =
  | "succeeded"
  | "declined"
  | "timeout"
  | "error";

export interface SimulationResult {
  outcome: SimulationOutcome;
  reference: string;
  failureCode: string | null;
}

function hashToBucket(value: string): number {
  const digest = createHash("sha256").update(value).digest();
  return digest.readUInt32BE(0) % 100;
}

/**
 * Deterministic processor double. The same reference always yields the same
 * result, which is what makes timeout reconciliation meaningful.
 */
export function runSimulation(
  reference: string,
  scenario: Scenario,
  attemptNumber: number,
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
      const bucket = hashToBucket(reference);
      if (bucket < 78) {
        return { outcome: "succeeded", reference, failureCode: null };
      }
      if (bucket < 94) {
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

function actualLookup(reference: string): SimulationResult {
  const bucket = hashToBucket(`lookup:${reference}`);
  return bucket < 80
    ? { outcome: "succeeded", reference, failureCode: null }
    : { outcome: "declined", reference, failureCode: "card_declined" };
}

/** Reconciliation lookup for an operation whose outcome was unknown. */
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
