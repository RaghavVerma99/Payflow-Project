import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db";
import { disputes, type PaymentRow } from "../schema";

export interface PaymentCapacity {
  amount_minor: number;
  refunded_minor: number;
  refund_reserved_minor: number;
  disputed_minor: number;
  remaining_minor: number;
}

/**
 * The amount already committed to customer remediation. Open disputes hold
 * capacity; lost disputes have already consumed it. Won disputes do not.
 */
export function committedMinor(db: Db, paymentId: string): number {
  const row = db
    .select({
      total: sql<number>`coalesce(sum(${disputes.amountMinor}), 0)`,
    })
    .from(disputes)
    .where(
      and(
        eq(disputes.paymentId, paymentId),
        inArray(disputes.status, ["open", "lost"]),
      ),
    )
    .get();

  return Number(row?.total ?? 0);
}

export function committedMinorByPayment(
  db: Db,
  paymentIds: string[],
): Map<string, number> {
  if (paymentIds.length === 0) return new Map();

  const rows = db
    .select({
      paymentId: disputes.paymentId,
      total: sql<number>`coalesce(sum(${disputes.amountMinor}), 0)`,
    })
    .from(disputes)
    .where(
      and(
        inArray(disputes.paymentId, paymentIds),
        inArray(disputes.status, ["open", "lost"]),
      ),
    )
    .groupBy(disputes.paymentId)
    .all();

  return new Map(rows.map((row) => [row.paymentId, Number(row.total)]));
}

export function paymentCapacity(
  db: Db,
  payment: PaymentRow,
): PaymentCapacity {
  const disputed = committedMinor(db, payment.id);
  const committed =
    payment.refundedMinor + payment.refundReservedMinor + disputed;

  return {
    amount_minor: payment.amountMinor,
    refunded_minor: payment.refundedMinor,
    refund_reserved_minor: payment.refundReservedMinor,
    disputed_minor: disputed,
    remaining_minor: Math.max(0, payment.amountMinor - committed),
  };
}
