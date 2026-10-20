import type {
  PaymentAttemptRow,
  PaymentEventRow,
  PaymentRow,
  RefundRow,
} from "../schema";
import { formatMinor, type PaymentStatus, type RefundStatus } from "../domain";

export function serializePayment(payment: PaymentRow) {
  return {
    object: "payment" as const,
    id: payment.id,
    status: payment.status as PaymentStatus,
    amount_minor: payment.amountMinor,
    amount: formatMinor(payment.amountMinor),
    currency: payment.currency,
    customer_id: payment.customerId,
    description: payment.description,
    failure_code: payment.failureCode,
    refunded_minor: payment.refundedMinor,
    refund_reserved_minor: payment.refundReservedMinor,
    refundable_minor: Math.max(
      0,
      payment.amountMinor - payment.refundedMinor - payment.refundReservedMinor,
    ),
    created_at: payment.createdAt,
    updated_at: payment.updatedAt,
  };
}

export type PaymentView = ReturnType<typeof serializePayment>;

export function serializeRefund(refund: RefundRow) {
  return {
    object: "refund" as const,
    id: refund.id,
    payment_id: refund.paymentId,
    status: refund.status as RefundStatus,
    amount_minor: refund.amountMinor,
    amount: formatMinor(refund.amountMinor),
    currency: refund.currency,
    reason: refund.reason,
    failure_code: refund.failureCode,
    created_at: refund.createdAt,
    updated_at: refund.updatedAt,
  };
}

export type RefundView = ReturnType<typeof serializeRefund>;

export function serializeAttempt(attempt: PaymentAttemptRow) {
  return {
    id: attempt.id,
    attempt_number: attempt.attemptNumber,
    status: attempt.status,
    processor_reference: attempt.processorReference,
    failure_code: attempt.failureCode,
    started_at: attempt.startedAt,
    finished_at: attempt.finishedAt,
  };
}

export function serializeEvent(event: PaymentEventRow) {
  return {
    id: event.id,
    type: event.type,
    from_status: event.fromStatus,
    to_status: event.toStatus,
    reason: event.reason,
    created_at: event.createdAt,
  };
}
