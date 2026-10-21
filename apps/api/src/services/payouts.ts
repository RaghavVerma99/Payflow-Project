import { and, desc, eq, lt, or } from "drizzle-orm";
import type { Db } from "../db";
import { payouts, type PayoutRow } from "../schema";
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
import { accountBalance } from "./ledger";
import { emitWebhookEvent } from "./webhooks";

export interface CreatePayoutInput {
  merchantId: string;
  amountMinor: number;
  destination: string;
  scenario?: string | null;
  idempotencyKey?: string | null;
  idempotencyTtlHours: number;
  maxJobAttempts?: number;
}

export function createPayout(
  db: Db,
  input: CreatePayoutInput,
): { payout: PayoutRow; replayed: boolean } {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw errors.invalid("amount_minor must be a positive integer.");
  }
  if (!input.destination.trim()) {
    throw errors.invalid("destination is required.");
  }

  const scenario = parseScenario(input.scenario);
  const requestHash = sha256(
    JSON.stringify({
      amount_minor: input.amountMinor,
      destination: input.destination,
      scenario,
    }),
  );

  const idempotency = input.idempotencyKey
    ? {
        merchantId: input.merchantId,
        operation: "payout.create",
        key: input.idempotencyKey,
        requestHash,
        ttlHours: input.idempotencyTtlHours,
      }
    : null;

  const result = withIdempotency(db, idempotency, (tx) => {
    const t = tx as unknown as Db;

    const available = accountBalance(t, input.merchantId, "merchant_payable");
    if (available < input.amountMinor) {
      throw errors.insufficientBalance(
        `Payout exceeds the available merchant balance of ${available} minor units.`,
      );
    }

    const now = nowIso();
    const payout: PayoutRow = {
      id: newId("po"),
      merchantId: input.merchantId,
      amountMinor: input.amountMinor,
      currency: "INR",
      destination: input.destination,
      status: "pending",
      failureCode: null,
      processorReference: null,
      createdAt: now,
      updatedAt: now,
    };

    t.insert(payouts).values(payout).run();

    enqueue(t, {
      kind: "process_payout",
      aggregateId: payout.id,
      payload: { payout_id: payout.id, scenario },
      maxAttempts: input.maxJobAttempts,
    });

    return {
      value: payout,
      status: 202,
      body: payout,
      resourceId: payout.id,
    };
  });

  if (result.kind === "replay") {
    const body = result.body as { id?: string } | null;
    if (!body?.id) throw errors.conflict("Idempotent replay had no payout.");
    return {
      payout: getPayout(db, input.merchantId, body.id),
      replayed: true,
    };
  }

  return { payout: result.value, replayed: false };
}

export function getPayout(
  db: Db,
  merchantId: string,
  payoutId: string,
): PayoutRow {
  const payout = db
    .select()
    .from(payouts)
    .where(and(eq(payouts.id, payoutId), eq(payouts.merchantId, merchantId)))
    .get();

  if (!payout) throw errors.notFound("Payout");
  return payout;
}

export function listPayouts(
  db: Db,
  options: {
    merchantId: string;
    limit: number;
    cursor?: string | null;
    status?: string | null;
  },
): Page<PayoutRow> {
  const anchor = options.cursor ? decodeCursor(options.cursor) : null;

  const rows = db
    .select()
    .from(payouts)
    .where(
      and(
        eq(payouts.merchantId, options.merchantId),
        options.status ? eq(payouts.status, options.status) : undefined,
        anchor
          ? or(
              lt(payouts.createdAt, anchor.createdAt),
              and(
                eq(payouts.createdAt, anchor.createdAt),
                lt(payouts.id, anchor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(payouts.createdAt), desc(payouts.id))
    .limit(options.limit + 1)
    .all();

  const hasMore = rows.length > options.limit;
  const page = rows.slice(0, options.limit);
  const last = page[page.length - 1];

  return {
    data: page,
    has_more: hasMore,
    next_cursor: hasMore && last ? encodeCursor(last) : null,
  };
}

export function markPayoutPaid(
  tx: Db,
  payout: PayoutRow,
  reference: string,
): void {
  tx.update(payouts)
    .set({
      status: "paid",
      processorReference: reference,
      failureCode: null,
      updatedAt: nowIso(),
    })
    .where(eq(payouts.id, payout.id))
    .run();
}

export function markPayoutFailed(
  tx: Db,
  payout: PayoutRow,
  reference: string,
  failureCode: string,
): void {
  tx.update(payouts)
    .set({
      status: "failed",
      processorReference: reference,
      failureCode,
      updatedAt: nowIso(),
    })
    .where(eq(payouts.id, payout.id))
    .run();
}

export function emitPayoutEvent(
  tx: Db,
  payout: PayoutRow,
  type: "payout.paid" | "payout.failed",
): void {
  emitWebhookEvent(tx, payout.merchantId, type, {
    id: payout.id,
    amount_minor: payout.amountMinor,
    amount: (payout.amountMinor / 100).toFixed(2),
    currency: payout.currency,
    destination: payout.destination,
    status: payout.status,
  });
}
