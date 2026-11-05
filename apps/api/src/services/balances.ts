import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db";
import { disputes, payments, payouts } from "../schema";
import { accountBalance } from "./ledger";

export interface PayoutAvailability {
  payable_minor: number;
  pending_payouts_minor: number;
  refunds_in_flight_minor: number;
  open_disputes_minor: number;
  available_minor: number;
}

export function payoutAvailability(
  db: Db,
  merchantId: string,
): PayoutAvailability {
  const payable = accountBalance(db, merchantId, "merchant_payable");

  const pendingPayouts = db
    .select({
      total: sql<number>`coalesce(sum(${payouts.amountMinor}), 0)`,
    })
    .from(payouts)
    .where(
      and(
        eq(payouts.merchantId, merchantId),
        inArray(payouts.status, ["pending", "processing", "unknown"]),
      ),
    )
    .get();

  const refundsInFlight = db
    .select({
      total: sql<number>`coalesce(sum(${payments.refundReservedMinor}), 0)`,
    })
    .from(payments)
    .where(eq(payments.merchantId, merchantId))
    .get();

  const openDisputes = db
    .select({
      total: sql<number>`coalesce(sum(${disputes.amountMinor}), 0)`,
    })
    .from(disputes)
    .where(
      and(eq(disputes.merchantId, merchantId), eq(disputes.status, "open")),
    )
    .get();

  const pendingPayoutsMinor = Number(pendingPayouts?.total ?? 0);
  const refundsInFlightMinor = Number(refundsInFlight?.total ?? 0);
  const openDisputesMinor = Number(openDisputes?.total ?? 0);

  return {
    payable_minor: payable,
    pending_payouts_minor: pendingPayoutsMinor,
    refunds_in_flight_minor: refundsInFlightMinor,
    open_disputes_minor: openDisputesMinor,
    available_minor: Math.max(
      0,
      payable - pendingPayoutsMinor - refundsInFlightMinor - openDisputesMinor,
    ),
  };
}
