import {
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { Db } from "../db";
import {
  jobs,
  payments,
  payouts,
  refunds,
  webhookEvents,
  type JobRow,
} from "../schema";
import { addSeconds, backoffSeconds, errors, newId, nowIso } from "../domain";

export type JobKind =
  | "process_payment"
  | "reconcile_payment"
  | "process_refund"
  | "reconcile_refund"
  | "process_payout"
  | "reconcile_payout"
  | "deliver_webhooks";

export interface EnqueueOptions {
  kind: JobKind;
  aggregateId: string;
  payload: Record<string, unknown>;
  runAt?: string;
  maxAttempts?: number;
}

export function enqueue(tx: Db, options: EnqueueOptions): string {
  const now = nowIso();
  const id = newId("job");
  tx.insert(jobs)
    .values({
      id,
      kind: options.kind,
      aggregateId: options.aggregateId,
      payload: JSON.stringify(options.payload),
      status: "pending",
      attempts: 0,
      maxAttempts: options.maxAttempts ?? 5,
      nextRunAt: options.runAt ?? now,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

export function cancelPendingJobs(tx: Db, aggregateId: string): number {
  const result = tx
    .update(jobs)
    .set({ status: "canceled", updatedAt: nowIso() })
    .where(
      and(
        eq(jobs.aggregateId, aggregateId),
        inArray(jobs.status, ["pending", "retrying"]),
      ),
    )
    .run();
  return result.changes;
}

export function claimNextJob(
  db: Db,
  workerId: string,
  leaseSeconds: number,
): JobRow | null {
  return db.transaction(
    (tx) => {
      const t = tx as unknown as Db;
      const now = nowIso();

      t.update(jobs)
        .set({
          status: "retrying",
          claimedBy: null,
          leaseExpiresAt: null,
          updatedAt: now,
        })
        .where(and(eq(jobs.status, "running"), lt(jobs.leaseExpiresAt, now)))
        .run();

      const candidate = t
        .select()
        .from(jobs)
        .where(
          and(
            inArray(jobs.status, ["pending", "retrying"]),
            lte(jobs.nextRunAt, now),
          ),
        )
        .orderBy(asc(jobs.createdAt), asc(jobs.id))
        .limit(1)
        .get();

      if (!candidate) return null;

      const attempts = candidate.attempts + 1;
      const claimed = t
        .update(jobs)
        .set({
          status: "running",
          attempts,
          claimedBy: workerId,
          leaseExpiresAt: addSeconds(now, leaseSeconds),
          updatedAt: now,
        })
        .where(
          and(
            eq(jobs.id, candidate.id),
            inArray(jobs.status, ["pending", "retrying"]),
          ),
        )
        .run();

      if (claimed.changes !== 1) return null;

      return {
        ...candidate,
        status: "running",
        attempts,
        claimedBy: workerId,
        leaseExpiresAt: addSeconds(now, leaseSeconds),
      };
    },
    { behavior: "immediate" },
  );
}

export function completeJob(db: Db, jobId: string): void {
  db.update(jobs)
    .set({
      status: "succeeded",
      claimedBy: null,
      leaseExpiresAt: null,
      lastError: null,
      updatedAt: nowIso(),
    })
    .where(eq(jobs.id, jobId))
    .run();
}

export type JobFailure = "retry" | "dead";

export function failJob(
  db: Db,
  jobId: string,
  error: unknown,
  maxAttemptsFallback = 5,
): JobFailure {
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!job) return "dead";

  const message =
    error instanceof Error ? error.message : String(error ?? "unknown error");
  const now = nowIso();
  const maxAttempts = job.maxAttempts ?? maxAttemptsFallback;

  if (job.attempts >= maxAttempts) {
    db.update(jobs)
      .set({
        status: "dead",
        claimedBy: null,
        leaseExpiresAt: null,
        lastError: message,
        updatedAt: now,
      })
      .where(eq(jobs.id, jobId))
      .run();
    return "dead";
  }

  const backoff = backoffSeconds(job.attempts);
  db.update(jobs)
    .set({
      status: "retrying",
      claimedBy: null,
      leaseExpiresAt: null,
      lastError: message,
      nextRunAt: addSeconds(now, backoff),
      updatedAt: now,
    })
    .where(eq(jobs.id, jobId))
    .run();
  return "retry";
}

export function jobStatusCounts(db: Db): Record<string, number> {
  const rows = db
    .select({ status: jobs.status, count: sql<number>`count(*)` })
    .from(jobs)
    .groupBy(jobs.status)
    .all();
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
}

function merchantJobCondition(db: Db, merchantId: string) {
  return or(
    exists(
      db
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.id, jobs.aggregateId),
            eq(payments.merchantId, merchantId),
          ),
        ),
    ),
    exists(
      db
        .select({ id: refunds.id })
        .from(refunds)
        .where(
          and(
            eq(refunds.id, jobs.aggregateId),
            eq(refunds.merchantId, merchantId),
          ),
        ),
    ),
    exists(
      db
        .select({ id: payouts.id })
        .from(payouts)
        .where(
          and(
            eq(payouts.id, jobs.aggregateId),
            eq(payouts.merchantId, merchantId),
          ),
        ),
    ),
    exists(
      db
        .select({ id: webhookEvents.id })
        .from(webhookEvents)
        .where(
          and(
            eq(webhookEvents.id, jobs.aggregateId),
            eq(webhookEvents.merchantId, merchantId),
          ),
        ),
    ),
  );
}

export type MerchantJobStatus =
  | "pending"
  | "retrying"
  | "running"
  | "succeeded"
  | "dead"
  | "canceled";

export interface MerchantJob {
  id: string;
  kind: string;
  aggregate_id: string | null;
  status: MerchantJobStatus;
  attempts: number;
  max_attempts: number;
  next_run_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export function listMerchantJobs(
  db: Db,
  merchantId: string,
  limit: number,
  status?: string,
): MerchantJob[] {
  const rows = db
    .select({
      id: jobs.id,
      kind: jobs.kind,
      aggregate_id: jobs.aggregateId,
      status: jobs.status,
      attempts: jobs.attempts,
      max_attempts: jobs.maxAttempts,
      next_run_at: jobs.nextRunAt,
      last_error: jobs.lastError,
      created_at: jobs.createdAt,
      updated_at: jobs.updatedAt,
    })
    .from(jobs)
    .where(
      and(
        merchantJobCondition(db, merchantId),
        status ? eq(jobs.status, status) : undefined,
      ),
    )
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .limit(limit)
    .all();

  return rows.map((row) => ({
    ...row,
    status: row.status as MerchantJobStatus,
  }));
}

export function merchantJobSummary(
  db: Db,
  merchantId: string,
): {
  by_status: Record<string, number>;
  oldest_active_at: string | null;
  oldest_active_age_seconds: number | null;
} {
  const condition = merchantJobCondition(db, merchantId);
  const rows = db
    .select({ status: jobs.status, count: sql<number>`count(*)` })
    .from(jobs)
    .where(condition)
    .groupBy(jobs.status)
    .all();
  const oldest = db
    .select({ createdAt: jobs.createdAt })
    .from(jobs)
    .where(
      and(condition, inArray(jobs.status, ["pending", "retrying", "running"])),
    )
    .orderBy(asc(jobs.createdAt), asc(jobs.id))
    .limit(1)
    .get();

  return {
    by_status: Object.fromEntries(
      rows.map((row) => [row.status, Number(row.count)]),
    ),
    oldest_active_at: oldest?.createdAt ?? null,
    oldest_active_age_seconds: oldest
      ? Math.max(
          0,
          Math.floor((Date.now() - Date.parse(oldest.createdAt)) / 1000),
        )
      : null,
  };
}

export function retryDeadJob(
  db: Db,
  merchantId: string,
  jobId: string,
): MerchantJob {
  return db.transaction(
    (tx) => {
      const t = tx as unknown as Db;
      const condition = merchantJobCondition(t, merchantId);
      const job = t
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, jobId), condition))
        .get();
      if (!job) throw errors.notFound("Job");
      if (job.status !== "dead") {
        throw errors.conflict(
          "Only dead-letter jobs can be retried.",
          "job_not_dead",
        );
      }

      if (job.kind === "deliver_webhooks" && job.aggregateId) {
        t.update(webhookEvents)
          .set({ status: "failed", lastError: null, updatedAt: nowIso() })
          .where(eq(webhookEvents.id, job.aggregateId))
          .run();
      }

      const now = nowIso();
      t.update(jobs)
        .set({
          status: "pending",
          attempts: 0,
          nextRunAt: now,
          claimedBy: null,
          leaseExpiresAt: null,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(jobs.id, job.id))
        .run();

      return {
        id: job.id,
        kind: job.kind,
        aggregate_id: job.aggregateId,
        status: "pending",
        attempts: 0,
        max_attempts: job.maxAttempts,
        next_run_at: now,
        last_error: null,
        created_at: job.createdAt,
        updated_at: now,
      };
    },
    { behavior: "immediate" },
  );
}
