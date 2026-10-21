import { and, gte, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "../db";
import { disputes, payments, payouts, refunds } from "../schema";
import { formatMinor } from "../domain";

const SUCCESSFUL = ["succeeded", "partially_refunded", "refunded"] as const;

export interface PaymentReportRow {
  id: string;
  created_at: string;
  status: string;
  amount_minor: number;
  amount: string;
  currency: string;
  customer_id: string | null;
  description: string | null;
  refunded_minor: number;
  failure_code: string | null;
}

export interface PaymentReport {
  from: string;
  to: string;
  payments: number;
  succeeded: number;
  failed: number;
  gross_minor: number;
  refunded_minor: number;
  net_minor: number;
  rows: PaymentReportRow[];
}

export function paymentReport(
  db: Db,
  merchantId: string,
  from: string,
  to: string,
): PaymentReport {
  const rows = db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.merchantId, merchantId),
        gte(payments.createdAt, from),
        lte(payments.createdAt, to),
      ),
    )
    .orderBy(payments.createdAt)
    .all();

  let gross = 0;
  let refunded = 0;
  let succeeded = 0;
  let failed = 0;

  const mapped: PaymentReportRow[] = rows.map((row) => {
    if ((SUCCESSFUL as readonly string[]).includes(row.status)) {
      gross += row.amountMinor;
      succeeded += 1;
    }
    if (row.status === "failed") failed += 1;
    refunded += row.refundedMinor;

    return {
      id: row.id,
      created_at: row.createdAt,
      status: row.status,
      amount_minor: row.amountMinor,
      amount: formatMinor(row.amountMinor),
      currency: row.currency,
      customer_id: row.customerId,
      description: row.description,
      refunded_minor: row.refundedMinor,
      failure_code: row.failureCode,
    };
  });

  return {
    from,
    to,
    payments: rows.length,
    succeeded,
    failed,
    gross_minor: gross,
    refunded_minor: refunded,
    net_minor: gross - refunded,
    rows: mapped,
  };
}

export function paymentReportCsv(report: PaymentReport): string {
  const header = [
    "id",
    "created_at",
    "status",
    "amount_minor",
    "amount",
    "currency",
    "customer_id",
    "description",
    "refunded_minor",
    "failure_code",
  ];

  const lines = [header.join(",")];

  for (const row of report.rows) {
    lines.push(
      [
        row.id,
        row.created_at,
        row.status,
        String(row.amount_minor),
        row.amount,
        row.currency,
        row.customer_id ?? "",
        row.description ?? "",
        String(row.refunded_minor),
        row.failure_code ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }

  return lines.join("\n");
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export interface SettlementReport {
  date: string;
  captured_minor: number;
  refunded_minor: number;
  dispute_loss_minor: number;
  paid_out_minor: number;
  net_minor: number;
  payments: number;
  refunds: number;
  disputes: number;
  payouts: number;
}

export function settlementReport(
  db: Db,
  merchantId: string,
  date: string,
): SettlementReport {
  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd = `${date}T23:59:59.999Z`;

  const captured = db
    .select({
      total: sql<number>`coalesce(sum(${payments.amountMinor}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.merchantId, merchantId),
        inArray(payments.status, [...SUCCESSFUL]),
        gte(payments.createdAt, dayStart),
        lte(payments.createdAt, dayEnd),
      ),
    )
    .get();

  const refundRows = db
    .select({
      total: sql<number>`coalesce(sum(${refunds.amountMinor}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(refunds)
    .where(
      and(
        eq(refunds.merchantId, merchantId),
        eq(refunds.status, "succeeded"),
        gte(refunds.createdAt, dayStart),
        lte(refunds.createdAt, dayEnd),
      ),
    )
    .get();

  const disputeRows = db
    .select({
      total: sql<number>`coalesce(sum(${disputes.amountMinor}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(disputes)
    .where(
      and(
        eq(disputes.merchantId, merchantId),
        eq(disputes.status, "lost"),
        gte(disputes.createdAt, dayStart),
        lte(disputes.createdAt, dayEnd),
      ),
    )
    .get();

  const payoutRows = db
    .select({
      total: sql<number>`coalesce(sum(${payouts.amountMinor}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(payouts)
    .where(
      and(
        eq(payouts.merchantId, merchantId),
        eq(payouts.status, "paid"),
        gte(payouts.createdAt, dayStart),
        lte(payouts.createdAt, dayEnd),
      ),
    )
    .get();

  const capturedMinor = Number(captured?.total ?? 0);
  const refundedMinor = Number(refundRows?.total ?? 0);
  const disputeLossMinor = Number(disputeRows?.total ?? 0);
  const paidOutMinor = Number(payoutRows?.total ?? 0);

  return {
    date,
    captured_minor: capturedMinor,
    refunded_minor: refundedMinor,
    dispute_loss_minor: disputeLossMinor,
    paid_out_minor: paidOutMinor,
    net_minor: capturedMinor - refundedMinor - disputeLossMinor - paidOutMinor,
    payments: Number(captured?.count ?? 0),
    refunds: Number(refundRows?.count ?? 0),
    disputes: Number(disputeRows?.count ?? 0),
    payouts: Number(payoutRows?.count ?? 0),
  };
}
