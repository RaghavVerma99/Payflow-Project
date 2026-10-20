import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { Db } from "../db";
import { payments, refunds, type PaymentRow, type RefundRow } from "../schema";
import {
  decodeCursor,
  encodeCursor,
  errors,
  newId,
  nowIso,
  parseScenario,
  sha256,
  type Page,
} from "../domain";
import { enqueue } from "./jobs";
import { withIdempotency } from "./idempotency";
import { addPaymentEvent, getPayment } from "./payments";
import { serializeRefund, type RefundView } from "./serializers";

export function refundableMinor(payment: PaymentRow): number {
  return Math.max(
    0,
    payment.amountMinor - payment.refundedMinor - payment.refundReservedMinor,
  );
}

export interface CreateRefundInput {
  merchantId: string;
  paymentId: string;
  amountMinor?: number | null;
  reason?: string | null;
  scenario?: string | null;
  idempotencyKey?: string | null;
  idempotencyTtlHours: number;
}

export function createRefund(
  db: Db,
  input: CreateRefundInput,
): { refund: RefundRow; replayed: boolean } {
  const scenario = parseScenario(input.scenario);

  const requestHash = sha256(
    JSON.stringify({
      payment_id: input.paymentId,
      amount_minor: input.amountMinor ?? null,
      reason: input.reason ?? null,
      scenario,
    }),
  );

  const idempotency = input.idempotencyKey
    ? {
        merchantId: input.merchantId,
        operation: "refund.create",
        key: input.idempotencyKey,
        requestHash,
        ttlHours: input.idempotencyTtlHours,
      }
    : null;

  const result = withIdempotency(db, idempotency, (tx) => {
    const t = tx as unknown as Db;
    const payment = getPayment(t, input.merchantId, input.paymentId);

    if (!["succeeded", "partially_refunded"].includes(payment.status)) {
      throw errors.notRefundable();
    }

    const remaining = refundableMinor(payment);
    const amount = input.amountMinor ?? remaining;

    if (!Number.isInteger(amount) || amount <= 0) {
      throw errors.invalid("amount_minor must be a positive integer.");
    }

    const now = nowIso();

    // Capacity is reserved with one conditional UPDATE. Two refunds racing for
    // the last rupee cannot both succeed, regardless of process count.
    const reserved = t
      .update(payments)
      .set({
        refundReservedMinor: sql`${payments.refundReservedMinor} + ${amount}`,
        updatedAt: now,
      })
      .where(
        and(
          eq(payments.id, payment.id),
          eq(payments.merchantId, input.merchantId),
          inArray(payments.status, ["succeeded", "partially_refunded"]),
          sql`${payments.refundedMinor} + ${payments.refundReservedMinor} + ${amount} <= ${payments.amountMinor}`,
        ),
      )
      .run();

    if (reserved.changes !== 1) {
      throw errors.refundCapacity();
    }

    const refund: RefundRow = {
      id: newId("ref"),
      paymentId: payment.id,
      merchantId: input.merchantId,
      amountMinor: amount,
      currency: payment.currency,
      status: "reserved",
      reason: input.reason ?? null,
      failureCode: null,
      processorReference: null,
      createdAt: now,
      updatedAt: now,
    };

    t.insert(refunds).values(refund).run();
    addPaymentEvent(
      t,
      payment.id,
      "refund.created",
      payment.status,
      payment.status,
      `Refund ${refund.id} reserved for ${amount} minor units.`,
    );
    enqueue(t, {
      kind: "process_refund",
      aggregateId: refund.id,
      payload: { refund_id: refund.id, scenario },
    });

    return {
      value: refund,
      status: 202,
      body: serializeRefund(refund),
      resourceId: refund.id,
    };
  });

  if (result.kind === "replay") {
    const body = result.body as { id?: string } | null;
    if (!body?.id) throw errors.conflict("Idempotent replay had no resource.");
    return {
      refund: getRefund(db, input.merchantId, body.id),
      replayed: true,
    };
  }

  return { refund: result.value, replayed: false };
}

export function getRefund(
  db: Db,
  merchantId: string,
  refundId: string,
): RefundRow {
  const refund = db
    .select()
    .from(refunds)
    .where(and(eq(refunds.id, refundId), eq(refunds.merchantId, merchantId)))
    .get();

  if (!refund) throw errors.notFound("Refund");
  return refund;
}

export interface ListRefundsOptions {
  merchantId: string;
  limit: number;
  cursor?: string | null;
  paymentId?: string | null;
  status?: string | null;
}

export function listRefunds(
  db: Db,
  options: ListRefundsOptions,
): Page<RefundView> {
  const cursor = options.cursor ? decodeCursor(options.cursor) : null;

  const rows = db
    .select()
    .from(refunds)
    .where(
      and(
        eq(refunds.merchantId, options.merchantId),
        options.paymentId ? eq(refunds.paymentId, options.paymentId) : undefined,
        options.status ? eq(refunds.status, options.status) : undefined,
        cursor
          ? or(
              lt(refunds.createdAt, cursor.createdAt),
              and(
                eq(refunds.createdAt, cursor.createdAt),
                lt(refunds.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(refunds.createdAt), desc(refunds.id))
    .limit(options.limit + 1)
    .all();

  const hasMore = rows.length > options.limit;
  const page = rows.slice(0, options.limit);
  const last = page[page.length - 1];

  return {
    data: page.map(serializeRefund),
    has_more: hasMore,
    next_cursor: hasMore && last ? encodeCursor(last) : null,
  };
}

export function listRefundsForPayment(
  db: Db,
  merchantId: string,
  paymentId: string,
): RefundView[] {
  return db
    .select()
    .from(refunds)
    .where(
      and(eq(refunds.merchantId, merchantId), eq(refunds.paymentId, paymentId)),
    )
    .orderBy(desc(refunds.createdAt))
    .all()
    .map(serializeRefund);
}
