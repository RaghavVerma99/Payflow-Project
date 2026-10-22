import { and, desc, eq, lt, or } from "drizzle-orm";
import type { Db } from "../db";
import { paymentMethods, type PaymentMethodRow } from "../schema";
import {
  decodeCursor,
  encodeCursor,
  errors,
  newId,
  nowIso,
  type Page,
  type PaymentMethodType,
} from "../domain";

export interface CreatePaymentMethodInput {
  merchantId: string;
  type: PaymentMethodType;
  label: string;
  last4?: string | null;
  network?: string | null;
  expiryMonth?: number | null;
  expiryYear?: number | null;
}

function assertInstrument(input: CreatePaymentMethodInput): void {
  if (input.type === "card") {
    if (!input.last4 || !/^\d{4}$/.test(input.last4)) {
      throw errors.invalid(
        "Card payment methods require a four digit last4.",
        "invalid_payment_method",
      );
    }
    if (
      input.expiryMonth &&
      (input.expiryMonth < 1 || input.expiryMonth > 12)
    ) {
      throw errors.invalid(
        "expiry_month must be between 1 and 12.",
        "invalid_payment_method",
      );
    }
    if (
      input.expiryYear &&
      (input.expiryYear < 2000 || input.expiryYear > 2100)
    ) {
      throw errors.invalid(
        "expiry_year must be a four digit year.",
        "invalid_payment_method",
      );
    }
  }
}

export function createPaymentMethod(
  db: Db,
  input: CreatePaymentMethodInput,
): PaymentMethodRow {
  assertInstrument(input);

  const method: PaymentMethodRow = {
    id: newId("pm"),
    merchantId: input.merchantId,
    type: input.type,
    label: input.label,
    last4: input.last4 ?? null,
    network: input.network ?? null,
    expiryMonth: input.expiryMonth ?? null,
    expiryYear: input.expiryYear ?? null,
    status: "active",
    createdAt: nowIso(),
  };

  db.insert(paymentMethods).values(method).run();
  return method;
}

export function getPaymentMethod(
  db: Db,
  merchantId: string,
  methodId: string,
): PaymentMethodRow {
  const method = db
    .select()
    .from(paymentMethods)
    .where(
      and(
        eq(paymentMethods.id, methodId),
        eq(paymentMethods.merchantId, merchantId),
      ),
    )
    .get();

  if (!method) throw errors.notFound("Payment method");
  return method;
}

export function requireActivePaymentMethod(
  db: Db,
  merchantId: string,
  methodId: string,
): PaymentMethodRow {
  const method = getPaymentMethod(db, merchantId, methodId);
  if (method.status !== "active") throw errors.paymentMethodInactive();
  return method;
}

export function disablePaymentMethod(
  db: Db,
  merchantId: string,
  methodId: string,
): PaymentMethodRow {
  const method = getPaymentMethod(db, merchantId, methodId);
  db.update(paymentMethods)
    .set({ status: "disabled" })
    .where(eq(paymentMethods.id, method.id))
    .run();
  return { ...method, status: "disabled" };
}

export function listPaymentMethods(
  db: Db,
  merchantId: string,
  limit: number,
  cursor?: string | null,
  status?: string | null,
): Page<PaymentMethodRow> {
  const anchor = cursor ? decodeCursor(cursor) : null;

  const rows = db
    .select()
    .from(paymentMethods)
    .where(
      and(
        eq(paymentMethods.merchantId, merchantId),
        status ? eq(paymentMethods.status, status) : undefined,
        anchor
          ? or(
              lt(paymentMethods.createdAt, anchor.createdAt),
              and(
                eq(paymentMethods.createdAt, anchor.createdAt),
                lt(paymentMethods.id, anchor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(paymentMethods.createdAt), desc(paymentMethods.id))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];

  return {
    data: page,
    has_more: hasMore,
    next_cursor: hasMore && last ? encodeCursor(last) : null,
  };
}
