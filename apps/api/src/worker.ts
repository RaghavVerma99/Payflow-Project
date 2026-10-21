import { and, eq, gte, sql } from "drizzle-orm";
import type { AppConfig } from "./config";
import type { Db } from "./db";
import { addPaymentEvent, transitionPayment } from "./services/payments";
import { claimNextJob, completeJob, enqueue, failJob } from "./services/jobs";
import {
  paymentJournalLines,
  postJournal,
  refundJournalLines,
} from "./services/ledger";
import {
  addSeconds,
  lookupSimulation,
  newId,
  nowIso,
  parseScenario,
  runSimulation,
  type PaymentStatus,
  type Scenario,
  type SimulationResult,
} from "./domain";
import {
  jobs,
  paymentAttempts,
  payments,
  refunds,
  type JobRow,
  type PaymentRow,
  type RefundRow,
} from "./schema";

export interface WorkerLogger {
  info: (obj: object, message?: string) => void;
  error: (obj: object, message?: string) => void;
}

export interface WorkerContext {
  db: Db;
  config: AppConfig;
  workerId: string;
  logger?: WorkerLogger;
}

interface JobPayload {
  payment_id?: string;
  refund_id?: string;
  scenario?: string;
  processor_reference?: string;
}

export function runOnce(ctx: WorkerContext): boolean {
  const job = claimNextJob(ctx.db, ctx.workerId, ctx.config.workerLeaseSeconds);
  if (!job) return false;

  ctx.logger?.info(
    { job_id: job.id, kind: job.kind, attempt: job.attempts },
    "worker.claimed",
  );

  try {
    executeJob(ctx, job);
    completeJob(ctx.db, job.id);
    ctx.logger?.info({ job_id: job.id, kind: job.kind }, "worker.completed");
  } catch (error) {
    const outcome = failJob(ctx.db, job.id, error, ctx.config.maxJobAttempts);
    ctx.logger?.error(
      { job_id: job.id, kind: job.kind, outcome, err: String(error) },
      "worker.failed",
    );
  }

  return true;
}

export function runDrain(ctx: WorkerContext, maxJobs = 50): number {
  let processed = 0;
  while (processed < maxJobs && runOnce(ctx)) {
    processed += 1;
  }
  return processed;
}

function parsePayload(job: JobRow): JobPayload {
  try {
    return JSON.parse(job.payload) as JobPayload;
  } catch {
    throw new Error(`Job ${job.id} has an unreadable payload.`);
  }
}

function executeJob(ctx: WorkerContext, job: JobRow): void {
  const payload = parsePayload(job);

  switch (job.kind) {
    case "process_payment":
      if (!payload.payment_id) throw new Error("Missing payment_id.");
      processPayment(ctx, payload.payment_id, payload.scenario);
      return;
    case "reconcile_payment":
      if (!payload.payment_id) throw new Error("Missing payment_id.");
      reconcilePayment(
        ctx,
        payload.payment_id,
        payload.processor_reference ?? null,
      );
      return;
    case "process_refund":
      if (!payload.refund_id) throw new Error("Missing refund_id.");
      processRefund(ctx, payload.refund_id, payload.scenario, job.attempts);
      return;
    case "reconcile_refund":
      if (!payload.refund_id) throw new Error("Missing refund_id.");
      reconcileRefund(ctx, payload.refund_id);
      return;
    default:
      throw new Error(`Unknown job kind: ${job.kind}`);
  }
}

function loadPayment(db: Db, paymentId: string): PaymentRow {
  const payment = db
    .select()
    .from(payments)
    .where(eq(payments.id, paymentId))
    .get();
  if (!payment) throw new Error(`Payment ${paymentId} does not exist.`);
  return payment;
}

function processPayment(
  ctx: WorkerContext,
  paymentId: string,
  rawScenario: string | undefined,
): void {
  const scenario: Scenario = parseScenario(rawScenario);

  const prepared = ctx.db.transaction(
    (tx) => {
      const t = tx as unknown as Db;
      const payment = loadPayment(t, paymentId);
      if (!["created", "processing"].includes(payment.status)) {
        return null;
      }

      const attemptNumber =
        (t
          .select({ value: sql<number>`count(*)` })
          .from(paymentAttempts)
          .where(eq(paymentAttempts.paymentId, paymentId))
          .get()?.value ?? 0) + 1;

      const reference = newId("proc");
      const start = nowIso();

      t.insert(paymentAttempts)
        .values({
          id: newId("att"),
          paymentId,
          attemptNumber: Number(attemptNumber),
          status: "started",
          processorReference: reference,
          startedAt: start,
        })
        .run();

      if (payment.status === "created") {
        transitionPayment(t, paymentId, "processing", {
          eventType: "payment.processing",
          reason: "Submitted to processor.",
        });
      }

      return { attemptNumber: Number(attemptNumber), reference };
    },
    { behavior: "immediate" },
  );

  if (!prepared) return;

  const result = runSimulation(
    prepared.reference,
    scenario,
    prepared.attemptNumber,
  );

  const reconciliationReference = prepared.reference;

  ctx.db.transaction(
    (tx) => {
      const t = tx as unknown as Db;
      const payment = loadPayment(t, paymentId);
      if (!["processing"].includes(payment.status)) return;

      t.update(paymentAttempts)
        .set({
          status: attemptStatus(result),
          failureCode: result.failureCode,
          finishedAt: nowIso(),
        })
        .where(
          and(
            eq(paymentAttempts.paymentId, paymentId),
            eq(paymentAttempts.attemptNumber, prepared.attemptNumber),
          ),
        )
        .run();

      applyPaymentOutcome(t, payment, result);

      if (result.outcome === "timeout") {
        enqueue(t, {
          kind: "reconcile_payment",
          aggregateId: paymentId,
          payload: {
            payment_id: paymentId,
            processor_reference: reconciliationReference,
          },
          runAt: addSeconds(nowIso(), 5),
          maxAttempts: ctx.config.maxJobAttempts,
        });
      }
    },
    { behavior: "immediate" },
  );

  if (result.outcome === "error") {
    throw new Error(result.failureCode ?? "processor_unavailable");
  }
}

function attemptStatus(result: SimulationResult): string {
  switch (result.outcome) {
    case "succeeded":
      return "succeeded";
    case "declined":
      return "declined";
    case "timeout":
      return "timed_out";
    case "error":
      return "errored";
  }
}

function applyPaymentOutcome(
  tx: Db,
  payment: PaymentRow,
  result: SimulationResult,
): void {
  switch (result.outcome) {
    case "succeeded":
      transitionPayment(tx, payment.id, "succeeded", {
        eventType: "payment.succeeded",
        reason: "Processor approved the charge.",
        failureCode: null,
      });
      postJournal(tx, {
        merchantId: payment.merchantId,
        sourceType: "payment",
        sourceId: payment.id,
        lines: paymentJournalLines(payment.amountMinor),
      });
      return;
    case "declined":
      transitionPayment(tx, payment.id, "failed", {
        eventType: "payment.failed",
        reason: "Processor declined the charge.",
        failureCode: result.failureCode,
      });
      return;
    case "timeout":
      transitionPayment(tx, payment.id, "unknown", {
        eventType: "payment.unknown",
        reason: "Processor timed out; reconciliation scheduled.",
        failureCode: result.failureCode,
      });
      return;
    case "error":
      return;
  }
}

function reconcilePayment(
  ctx: WorkerContext,
  paymentId: string,
  reference: string | null,
): void {
  const payment = loadPayment(ctx.db, paymentId);
  if (payment.status !== "unknown") return;

  const storedReference = reference ?? latestReference(ctx.db, paymentId);
  if (!storedReference) {
    throw new Error(`No processor reference for payment ${paymentId}.`);
  }

  const result = lookupSimulation(storedReference);

  ctx.db.transaction(
    (tx) => {
      const t = tx as unknown as Db;
      const current = loadPayment(t, paymentId);
      if (current.status !== "unknown") return;
      applyPaymentOutcome(t, current, result);
    },
    { behavior: "immediate" },
  );
}

function latestReference(db: Db, paymentId: string): string | null {
  const attempt = db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.paymentId, paymentId))
    .orderBy(sql`${paymentAttempts.attemptNumber} desc`)
    .limit(1)
    .get();
  return attempt?.processorReference ?? null;
}

function loadRefund(db: Db, refundId: string): RefundRow {
  const refund = db
    .select()
    .from(refunds)
    .where(eq(refunds.id, refundId))
    .get();
  if (!refund) throw new Error(`Refund ${refundId} does not exist.`);
  return refund;
}

function processRefund(
  ctx: WorkerContext,
  refundId: string,
  rawScenario: string | undefined,
  attemptNumber: number,
): void {
  const scenario = parseScenario(rawScenario);

  const prepared = ctx.db.transaction(
    (tx) => {
      const t = tx as unknown as Db;
      const refund = loadRefund(t, refundId);
      if (!["reserved", "processing"].includes(refund.status)) return null;

      const reference = refund.processorReference ?? newId("proc");
      t.update(refunds)
        .set({
          status: "processing",
          processorReference: reference,
          updatedAt: nowIso(),
        })
        .where(eq(refunds.id, refundId))
        .run();

      return { reference };
    },
    { behavior: "immediate" },
  );

  if (!prepared) return;

  const result = runSimulation(
    prepared.reference,
    scenario,
    Math.max(1, attemptNumber),
  );

  const reconcile = settleRefund(ctx.db, refundId, result);

  if (result.outcome === "error") {
    throw new Error(result.failureCode ?? "processor_unavailable");
  }

  if (reconcile) {
    enqueue(ctx.db, {
      kind: "reconcile_refund",
      aggregateId: refundId,
      payload: {
        refund_id: refundId,
        processor_reference: prepared.reference,
      },
      runAt: addSeconds(nowIso(), 5),
      maxAttempts: ctx.config.maxJobAttempts,
    });
  }
}

function reconcileRefund(ctx: WorkerContext, refundId: string): void {
  const refund = loadRefund(ctx.db, refundId);
  if (refund.status !== "unknown") return;
  if (!refund.processorReference) {
    throw new Error(`No processor reference for refund ${refundId}.`);
  }

  const result = lookupSimulation(refund.processorReference);
  settleRefund(ctx.db, refundId, result);
}

function settleRefund(
  db: Db,
  refundId: string,
  result: SimulationResult,
): boolean {
  return db.transaction(
    (tx) => {
      const t = tx as unknown as Db;
      const refund = loadRefund(t, refundId);
      if (!["processing", "unknown"].includes(refund.status)) return false;

      const payment = loadPayment(t, refund.paymentId);
      const now = nowIso();

      if (result.outcome === "timeout") {
        t.update(refunds)
          .set({
            status: "unknown",
            failureCode: result.failureCode,
            updatedAt: now,
          })
          .where(eq(refunds.id, refundId))
          .run();
        addPaymentEvent(
          t,
          refund.paymentId,
          "refund.unknown",
          payment.status,
          payment.status,
          `Refund ${refund.id} timed out; reconciliation scheduled.`,
        );
        return true;
      }

      if (result.outcome === "error") {
        t.update(refunds)
          .set({ status: "reserved", updatedAt: now })
          .where(eq(refunds.id, refundId))
          .run();
        return false;
      }

      if (result.outcome === "declined") {
        t.update(refunds)
          .set({
            status: "failed",
            failureCode: result.failureCode,
            updatedAt: now,
          })
          .where(eq(refunds.id, refundId))
          .run();

        releaseReservation(t, refund);
        addPaymentEvent(
          t,
          refund.paymentId,
          "refund.failed",
          payment.status,
          payment.status,
          `Refund ${refund.id} failed; reservation released.`,
        );
        return false;
      }

      t.update(refunds)
        .set({
          status: "succeeded",
          failureCode: null,
          updatedAt: now,
        })
        .where(eq(refunds.id, refundId))
        .run();

      const settled = t
        .update(payments)
        .set({
          refundedMinor: sql`${payments.refundedMinor} + ${refund.amountMinor}`,
          refundReservedMinor: sql`${payments.refundReservedMinor} - ${refund.amountMinor}`,
          updatedAt: now,
        })
        .where(
          and(
            eq(payments.id, payment.id),
            gte(payments.refundReservedMinor, refund.amountMinor),
          ),
        )
        .run();

      if (settled.changes !== 1) {
        throw new Error(
          `Refund ${refund.id} could not be settled: reservation missing.`,
        );
      }

      const after = loadPayment(t, payment.id);
      const target: PaymentStatus =
        after.refundedMinor >= after.amountMinor
          ? "refunded"
          : "partially_refunded";

      if (after.status === target) {
        addPaymentEvent(
          t,
          payment.id,
          "refund.succeeded",
          after.status,
          target,
          `Refund ${refund.id} settled.`,
        );
      } else {
        transitionPayment(t, payment.id, target, {
          eventType: "refund.succeeded",
          reason: `Refund ${refund.id} settled.`,
        });
      }

      postJournal(t, {
        merchantId: payment.merchantId,
        sourceType: "refund",
        sourceId: refund.id,
        lines: refundJournalLines(refund.amountMinor),
      });

      return false;
    },
    { behavior: "immediate" },
  );
}

function releaseReservation(tx: Db, refund: RefundRow): void {
  const released = tx
    .update(payments)
    .set({
      refundReservedMinor: sql`${payments.refundReservedMinor} - ${refund.amountMinor}`,
      updatedAt: nowIso(),
    })
    .where(
      and(
        eq(payments.id, refund.paymentId),
        gte(payments.refundReservedMinor, refund.amountMinor),
      ),
    )
    .run();

  if (released.changes !== 1) {
    throw new Error(
      `Refund ${refund.id} reservation could not be released safely.`,
    );
  }
}

export function startWorker(
  ctx: WorkerContext,
  options: { pollMs?: number; maxJobsPerTick?: number } = {},
): { stop: () => void } {
  const pollMs = options.pollMs ?? ctx.config.workerPollMs;
  const maxJobsPerTick = options.maxJobsPerTick ?? 20;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = () => {
    if (stopped) return;
    try {
      runDrain(ctx, maxJobsPerTick);
    } catch (error) {
      ctx.logger?.error({ err: String(error) }, "worker.tick_failed");
    } finally {
      if (!stopped) {
        timer = setTimeout(tick, pollMs);
        timer.unref();
      }
    }
  };

  timer = setTimeout(tick, 25);
  timer.unref();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

export function jobQueueDepth(db: Db): number {
  const row = db
    .select({ value: sql<number>`count(*)` })
    .from(jobs)
    .where(sql`${jobs.status} in ('pending','retrying','running')`)
    .get();
  return Number(row?.value ?? 0);
}
