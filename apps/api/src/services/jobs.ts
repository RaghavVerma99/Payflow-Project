import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import type { Db } from "../db";
import { jobs, type JobRow } from "../schema";
import { addSeconds, backoffSeconds, newId, nowIso } from "../domain";

export type JobKind =
  | "process_payment"
  | "reconcile_payment"
  | "process_refund"
  | "reconcile_refund";

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
