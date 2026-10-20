import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "../db";
import { payments, refunds } from "../schema";
import { accountSummaries, trialBalance, type AccountSummary } from "./ledger";
import { jobStatusCounts } from "./jobs";
import { serializePayment, type PaymentView } from "./serializers";

const SUCCESSFUL = [
  "succeeded",
  "partially_refunded",
  "refunded",
] as const;

export interface Overview {
  merchant: { id: string; name: string };
  payments: {
    total: number;
    succeeded: number;
    failed: number;
    processing: number;
    by_status: Record<string, number>;
    success_rate: number;
  };
  volume: {
    gross_minor: number;
    refunded_minor: number;
    net_minor: number;
  };
  refunds: {
    total: number;
    succeeded: number;
    by_status: Record<string, number>;
  };
  ledger: {
    balanced: boolean;
    debits_minor: number;
    credits_minor: number;
    accounts: AccountSummary[];
  };
  jobs: Record<string, number>;
  recent_payments: PaymentView[];
}

export function overview(
  db: Db,
  merchant: { id: string; name: string },
): Overview {
  const paymentRows = db
    .select({
      status: payments.status,
      count: sql<number>`count(*)`,
      volume: sql<number>`coalesce(sum(${payments.amountMinor}), 0)`,
    })
    .from(payments)
    .where(eq(payments.merchantId, merchant.id))
    .groupBy(payments.status)
    .all();

  const byStatus: Record<string, number> = {};
  let total = 0;
  let gross = 0;
  for (const row of paymentRows) {
    const count = Number(row.count);
    byStatus[row.status] = count;
    total += count;
    if ((SUCCESSFUL as readonly string[]).includes(row.status)) {
      gross += Number(row.volume);
    }
  }

  const refundedRow = db
    .select({
      total: sql<number>`coalesce(sum(${payments.refundedMinor}), 0)`,
    })
    .from(payments)
    .where(eq(payments.merchantId, merchant.id))
    .get();

  const refundRows = db
    .select({
      status: refunds.status,
      count: sql<number>`count(*)`,
    })
    .from(refunds)
    .where(eq(refunds.merchantId, merchant.id))
    .groupBy(refunds.status)
    .all();

  const refundsByStatus: Record<string, number> = {};
  let refundsTotal = 0;
  for (const row of refundRows) {
    refundsByStatus[row.status] = Number(row.count);
    refundsTotal += Number(row.count);
  }

  const succeeded = SUCCESSFUL.reduce(
    (sum, status) => sum + (byStatus[status] ?? 0),
    0,
  );
  const failed = byStatus.failed ?? 0;
  const settled = succeeded + failed;

  const recent = db
    .select()
    .from(payments)
    .where(eq(payments.merchantId, merchant.id))
    .orderBy(desc(payments.createdAt), desc(payments.id))
    .limit(6)
    .all();

  const trial = trialBalance(db, merchant.id);
  const accounts = accountSummaries(db, merchant.id);
  const refunded = Number(refundedRow?.total ?? 0);

  return {
    merchant,
    payments: {
      total,
      succeeded,
      failed,
      processing:
        (byStatus.processing ?? 0) +
        (byStatus.created ?? 0) +
        (byStatus.unknown ?? 0),
      by_status: byStatus,
      success_rate: settled === 0 ? 0 : succeeded / settled,
    },
    volume: {
      gross_minor: gross,
      refunded_minor: refunded,
      net_minor: gross - refunded,
    },
    refunds: {
      total: refundsTotal,
      succeeded: refundsByStatus.succeeded ?? 0,
      by_status: refundsByStatus,
    },
    ledger: {
      balanced: trial.balanced,
      debits_minor: trial.debits_minor,
      credits_minor: trial.credits_minor,
      accounts,
    },
    jobs: jobStatusCounts(db),
    recent_payments: recent.map(serializePayment),
  };
}

export interface TimeseriesPoint {
  date: string;
  payments: number;
  succeeded: number;
  failed: number;
  volume_minor: number;
}

export function timeseries(db: Db, merchantId: string, days: number): TimeseriesPoint[] {
  const start = new Date(
    Date.now() - (days - 1) * 24 * 60 * 60 * 1000,
  );
  const startIso = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  ).toISOString();

  const rows = db
    .select({
      day: sql<string>`substr(${payments.createdAt}, 1, 10)`,
      total: sql<number>`count(*)`,
      succeeded: sql<number>`sum(case when ${inArray(payments.status, [...SUCCESSFUL])} then 1 else 0 end)`,
      failed: sql<number>`sum(case when ${eq(payments.status, "failed")} then 1 else 0 end)`,
      volume: sql<number>`sum(case when ${inArray(payments.status, [...SUCCESSFUL])} then ${payments.amountMinor} else 0 end)`,
    })
    .from(payments)
    .where(
      and(eq(payments.merchantId, merchantId), gte(payments.createdAt, startIso)),
    )
    .groupBy(sql`substr(${payments.createdAt}, 1, 10)`)
    .orderBy(sql`substr(${payments.createdAt}, 1, 10)`)
    .all();

  const byDay = new Map(rows.map((row) => [row.day, row]));
  const points: TimeseriesPoint[] = [];

  for (let index = 0; index < days; index += 1) {
    const day = new Date(startIso);
    day.setUTCDate(day.getUTCDate() + index);
    const key = day.toISOString().slice(0, 10);
    const row = byDay.get(key);
    points.push({
      date: key,
      payments: Number(row?.total ?? 0),
      succeeded: Number(row?.succeeded ?? 0),
      failed: Number(row?.failed ?? 0),
      volume_minor: Number(row?.volume ?? 0),
    });
  }

  return points;
}
