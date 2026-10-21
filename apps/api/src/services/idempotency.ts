import { and, eq } from "drizzle-orm";
import type { Db } from "../db";
import { idempotencyRecords, type IdempotencyRow } from "../schema";
import { addHours, errors, newId, nowIso } from "../domain";

export interface IdempotencyInput {
  merchantId: string;
  operation: string;
  key: string;
  requestHash: string;
  ttlHours: number;
}

export interface WorkResult<T> {
  value: T;
  status: number;
  body: unknown;
  resourceId: string;
}

export type IdempotentResult<T> =
  | { kind: "fresh"; value: T }
  | { kind: "replay"; status: number; body: unknown };

function findRecord(
  db: Db,
  input: IdempotencyInput,
): IdempotencyRow | undefined {
  return db
    .select()
    .from(idempotencyRecords)
    .where(
      and(
        eq(idempotencyRecords.merchantId, input.merchantId),
        eq(idempotencyRecords.operation, input.operation),
        eq(idempotencyRecords.idempotencyKey, input.key),
      ),
    )
    .get();
}

function replay(record: IdempotencyRow): IdempotentResult<never> {
  return {
    kind: "replay",
    status: record.responseStatus ?? 200,
    body: record.responseBody ? JSON.parse(record.responseBody) : null,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { code?: string }).code === "string" &&
    (err as { code: string }).code.startsWith("SQLITE_CONSTRAINT")
  );
}

function isExpired(record: IdempotencyRow, now: string): boolean {
  return Date.parse(record.expiresAt) <= Date.parse(now);
}

export function withIdempotency<T>(
  db: Db,
  input: IdempotencyInput | null,
  work: (tx: Db) => WorkResult<T>,
  attempt = 0,
): IdempotentResult<T> {
  if (!input) {
    const result = db.transaction((tx) => work(tx as unknown as Db), {
      behavior: "immediate",
    });
    return { kind: "fresh", value: result.value };
  }

  try {
    return db.transaction(
      (tx) => {
        const t = tx as unknown as Db;
        const createdAt = nowIso();
        const existing = findRecord(t, input);

        if (existing && !isExpired(existing, createdAt)) {
          if (existing.requestHash !== input.requestHash) {
            throw errors.idempotencyMismatch();
          }
          if (existing.status !== "completed") {
            throw errors.idempotencyInProgress();
          }
          return replay(existing);
        }

        const recordId = existing?.id ?? newId("idem");

        if (existing) {
          t.update(idempotencyRecords)
            .set({
              requestHash: input.requestHash,
              status: "in_progress",
              resourceId: null,
              responseStatus: null,
              responseBody: null,
              createdAt,
              expiresAt: addHours(createdAt, input.ttlHours),
            })
            .where(eq(idempotencyRecords.id, recordId))
            .run();
        } else {
          t.insert(idempotencyRecords)
            .values({
              id: recordId,
              merchantId: input.merchantId,
              operation: input.operation,
              idempotencyKey: input.key,
              requestHash: input.requestHash,
              status: "in_progress",
              createdAt,
              expiresAt: addHours(createdAt, input.ttlHours),
            })
            .run();
        }

        const result = work(t);

        t.update(idempotencyRecords)
          .set({
            status: "completed",
            resourceId: result.resourceId,
            responseStatus: result.status,
            responseBody: JSON.stringify(result.body),
          })
          .where(eq(idempotencyRecords.id, recordId))
          .run();

        return { kind: "fresh", value: result.value } as IdempotentResult<T>;
      },
      { behavior: "immediate" },
    );
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;

    const winner = findRecord(db, input);
    if (!winner) throw err;

    if (isExpired(winner, nowIso()) && attempt === 0) {
      db.delete(idempotencyRecords)
        .where(eq(idempotencyRecords.id, winner.id))
        .run();
      return withIdempotency(db, input, work, attempt + 1);
    }

    if (winner.requestHash !== input.requestHash) {
      throw errors.idempotencyMismatch();
    }
    if (winner.status !== "completed") throw errors.idempotencyInProgress();
    return replay(winner);
  }
}
