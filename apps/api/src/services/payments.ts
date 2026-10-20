import { and, desc, eq, lt, or } from "drizzle-orm";
import type { Db } from "../db";
import {
  paymentAttempts,
  paymentEvents,
  payments,
  type PaymentRow,
} from "../schema";
import {
  assertTransition,
  decodeCursor,
  encodeCursor,
  errors,
  newId,
  nowIso,
  parseScenario,
  sha256,
  type Page,
  type PaymentStatus,
} from "../domain";
import { enqueue, cancelPendingJobs } from "./jobs";
import { withIdempotency } from "./idempotency";
import {
  serializeAttempt,
  serializeEvent,
  serializePayment,
  type PaymentView,
} from "./serializers";

export interface CreatePaymentInput {
  merchantId: string;
  amountMinor: number;
  currency: string;
  customerId?: string | null;
  description?: string | null;
  scenario?: string | null;
  idempotencyKey?: string | null;
  idempotencyTtlHours: number;
}

export function createPayment(
  db: Db,
  input: CreatePaymentInput,
): { payment: PaymentRow; replayed: boolean } {
  if (input.currency !== "INR") {
    throw errors.invalid(
      "Only INR is supported by this simulator.",
      "unsupported_currency",
    );
  }
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw errors.invalid("amount_minor must be a positive integer.");
  }

  const scenario = parseScenario(input.scenario);
  const requestHash = sha256(
    JSON.stringify({
      amount_minor: input.amountMinor,
      currency: "INR",
      customer_id: input.customerId ?? null,
      description: input.description ?? null,
      scenario,
    }),
  );

  const idempotency = input.idempotencyKey
    ? {
        merchantId: input.merchantId,
        operation: "payment.create",
        key: input.idempotencyKey,
        requestHash,
        ttlHours: input.idempotencyTtlHours,
      }
    : null;

  const result = withIdempotency(db, idempotency, (tx) => {
    const now = nowIso();
    const payment: PaymentRow = {
      id: newId("pay"),
      merchantId: input.merchantId,
      amountMinor: input.amountMinor,
      currency: "INR",
      status: "created",
      customerId: input.customerId ?? null,
      description: input.description ?? null,
      failureCode: null,
      refundedMinor: 0,
      refundReservedMinor: 0,
      createdAt: now,
      updatedAt: now,
    };

    tx.insert(payments).values(payment).run();
    addPaymentEvent(tx, payment.id, "payment.created", null, "created");
    enqueue(tx, {
      kind: "process_payment",
      aggregateId: payment.id,
      payload: { payment_id: payment.id, scenario },
    });

    return {
      value: payment,
      status: 202,
      body: serializePayment(payment),
      resourceId: payment.id,
    };
  });

  if (result.kind === "replay") {
    const body = result.body as { id?: string } | null;
    if (!body?.id) throw errors.conflict("Idempotent replay had no resource.");
    return {
      payment: getPayment(db, input.merchantId, body.id),
      replayed: true,
    };
  }

  return { payment: result.value, replayed: false };
}

export function addPaymentEvent(
  tx: Db,
  paymentId: string,
  type: string,
  fromStatus: string | null,
  toStatus: string,
  reason: string | null = null,
): void {
  tx.insert(paymentEvents)
    .values({
      id: newId("evt"),
      paymentId,
      type,
      fromStatus,
      toStatus,
      reason,
      createdAt: nowIso(),
    })
    .run();
}

export function getPayment(
  db: Db,
  merchantId: string,
  paymentId: string,
): PaymentRow {
  const payment = db
    .select()
    .from(payments)
    .where(
      and(eq(payments.id, paymentId), eq(payments.merchantId, merchantId)),
    )
    .get();

  if (!payment) throw errors.notFound("Payment");
  return payment;
}

export function getPaymentDetail(db: Db, merchantId: string, paymentId: string) {
  const payment = getPayment(db, merchantId, paymentId);

  const attempts = db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.paymentId, paymentId))
    .orderBy(paymentAttempts.attemptNumber)
    .all();

  const events = db
    .select()
    .from(paymentEvents)
    .where(eq(paymentEvents.paymentId, paymentId))
    .orderBy(paymentEvents.createdAt)
    .all();

  return {
    ...serializePayment(payment),
    attempts: attempts.map(serializeAttempt),
    events: events.map(serializeEvent),
  };
}

export interface ListPaymentsOptions {
  merchantId: string;
  limit: number;
  cursor?: string | null;
  status?: PaymentStatus | null;
}

export function listPayments(
  db: Db,
  options: ListPaymentsOptions,
): Page<PaymentView> {
  const cursor = options.cursor ? decodeCursor(options.cursor) : null;

  const rows = db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.merchantId, options.merchantId),
        options.status ? eq(payments.status, options.status) : undefined,
        cursor
          ? or(
              lt(payments.createdAt, cursor.createdAt),
              and(
                eq(payments.createdAt, cursor.createdAt),
                lt(payments.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(payments.createdAt), desc(payments.id))
    .limit(options.limit + 1)
    .all();

  const hasMore = rows.length > options.limit;
  const page = rows.slice(0, options.limit);
  const last = page[page.length - 1];

  return {
    data: page.map(serializePayment),
    has_more: hasMore,
    next_cursor: hasMore && last ? encodeCursor(last) : null,
  };
}

export function transitionPayment(
  tx: Db,
  paymentId: string,
  toStatus: PaymentStatus,
  options: {
    eventType?: string;
    reason?: string | null;
    failureCode?: string | null;
  } = {},
): PaymentRow {
  const current = tx
    .select()
    .from(payments)
    .where(eq(payments.id, paymentId))
    .get();

  if (!current) throw errors.notFound("Payment");
  if (current.status === toStatus) return current;

  assertTransition(current.status as PaymentStatus, toStatus);

  const updatedAt = nowIso();
  const update: Partial<PaymentRow> = { status: toStatus, updatedAt };
  if (options.failureCode !== undefined) {
    update.failureCode = options.failureCode;
  }

  const result = tx
    .update(payments)
    .set(update)
    .where(and(eq(payments.id, paymentId), eq(payments.status, current.status)))
    .run();

  if (result.changes !== 1) {
    // Another writer moved it first; return the authoritative row.
    return tx.select().from(payments).where(eq(payments.id, paymentId)).get()!;
  }

  addPaymentEvent(
    tx,
    paymentId,
    options.eventType ?? `payment.${toStatus}`,
    current.status,
    toStatus,
    options.reason ?? null,
  );

  return tx.select().from(payments).where(eq(payments.id, paymentId)).get()!;
}

export function cancelPayment(
  db: Db,
  merchantId: string,
  paymentId: string,
): PaymentRow {
  return db.transaction(
    (tx) => {
      const t = tx as unknown as Db;
      const payment = getPayment(t, merchantId, paymentId);
      if (payment.status !== "created") {
        throw errors.conflict(
          `Payment is ${payment.status}; only created payments can be canceled.`,
          "payment_not_cancelable",
        );
      }
      const updated = transitionPayment(t, paymentId, "canceled", {
        eventType: "payment.canceled",
        reason: "Canceled before processing.",
      });
      cancelPendingJobs(t, paymentId);
      return updated;
    },
    { behavior: "immediate" },
  );
}
