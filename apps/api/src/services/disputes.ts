import { and, desc, eq, lt, or } from "drizzle-orm";
import type { Db } from "../db";
import { disputes, payments, type DisputeRow } from "../schema";
import {
  decodeCursor,
  encodeCursor,
  errors,
  newId,
  nowIso,
  type Page,
} from "../domain";
import { disputeJournalLines, postJournal } from "./ledger";
import { emitWebhookEvent } from "./webhooks";

export interface CreateDisputeInput {
  merchantId: string;
  paymentId: string;
  amountMinor?: number | null;
  reason: string;
  note?: string | null;
}

export function createDispute(
  db: Db,
  input: CreateDisputeInput,
): DisputeRow {
  return db.transaction(
    (tx) => {
      const t = tx as unknown as Db;

      const payment = t
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.id, input.paymentId),
            eq(payments.merchantId, input.merchantId),
          ),
        )
        .get();

      if (!payment) throw errors.notFound("Payment");
      if (!["succeeded", "partially_refunded"].includes(payment.status)) {
        throw errors.paymentNotDisputable();
      }

      const amount = input.amountMinor ?? payment.amountMinor;
      if (!Number.isInteger(amount) || amount <= 0) {
        throw errors.invalid("amount_minor must be a positive integer.");
      }
      if (amount > payment.amountMinor) {
        throw errors.invalid(
          "amount_minor cannot exceed the original payment amount.",
        );
      }

      const now = nowIso();
      const dispute: DisputeRow = {
        id: newId("dp"),
        paymentId: payment.id,
        merchantId: input.merchantId,
        amountMinor: amount,
        reason: input.reason,
        status: "open",
        note: input.note ?? null,
        createdAt: now,
        resolvedAt: null,
      };

      t.insert(disputes).values(dispute).run();
      emitWebhookEvent(t, input.merchantId, "dispute.opened", {
        id: dispute.id,
        payment_id: dispute.paymentId,
        amount_minor: dispute.amountMinor,
        reason: dispute.reason,
        status: dispute.status,
      });

      return dispute;
    },
    { behavior: "immediate" },
  );
}

export function getDispute(
  db: Db,
  merchantId: string,
  disputeId: string,
): DisputeRow {
  const dispute = db
    .select()
    .from(disputes)
    .where(and(eq(disputes.id, disputeId), eq(disputes.merchantId, merchantId)))
    .get();

  if (!dispute) throw errors.notFound("Dispute");
  return dispute;
}

export function resolveDispute(
  db: Db,
  merchantId: string,
  disputeId: string,
  outcome: "won" | "lost",
  note?: string | null,
): DisputeRow {
  return db.transaction(
    (tx) => {
      const t = tx as unknown as Db;
      const dispute = getDispute(t, merchantId, disputeId);

      if (dispute.status !== "open") throw errors.disputeNotOpen();

      const now = nowIso();

      if (outcome === "lost") {
        postJournal(t, {
          merchantId,
          sourceType: "dispute",
          sourceId: dispute.id,
          lines: disputeJournalLines(dispute.amountMinor),
        });
      }

      t.update(disputes)
        .set({
          status: outcome,
          note: note ?? dispute.note,
          resolvedAt: now,
        })
        .where(eq(disputes.id, dispute.id))
        .run();

      emitWebhookEvent(t, merchantId, outcome === "won" ? "dispute.won" : "dispute.lost", {
        id: dispute.id,
        payment_id: dispute.paymentId,
        amount_minor: dispute.amountMinor,
        status: outcome,
      });

      return { ...dispute, status: outcome, resolvedAt: now };
    },
    { behavior: "immediate" },
  );
}

export function listDisputes(
  db: Db,
  options: {
    merchantId: string;
    limit: number;
    cursor?: string | null;
    status?: string | null;
  },
): Page<DisputeRow> {
  const anchor = options.cursor ? decodeCursor(options.cursor) : null;

  const rows = db
    .select()
    .from(disputes)
    .where(
      and(
        eq(disputes.merchantId, options.merchantId),
        options.status ? eq(disputes.status, options.status) : undefined,
        anchor
          ? or(
              lt(disputes.createdAt, anchor.createdAt),
              and(
                eq(disputes.createdAt, anchor.createdAt),
                lt(disputes.id, anchor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(disputes.createdAt), desc(disputes.id))
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
