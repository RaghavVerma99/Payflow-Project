import type {
  DisputeRow,
  PaymentAttemptRow,
  PaymentEventRow,
  PaymentMethodRow,
  PaymentRow,
  PayoutRow,
  RefundRow,
  WebhookDeliveryRow,
  WebhookEndpointRow,
  WebhookEventRow,
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
    payment_method_id: payment.paymentMethodId,
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

export function serializePaymentMethod(method: PaymentMethodRow) {
  return {
    object: "payment_method" as const,
    id: method.id,
    type: method.type,
    label: method.label,
    last4: method.last4,
    network: method.network,
    expiry_month: method.expiryMonth,
    expiry_year: method.expiryYear,
    status: method.status,
    created_at: method.createdAt,
  };
}

export function serializePayout(payout: PayoutRow) {
  return {
    object: "payout" as const,
    id: payout.id,
    status: payout.status,
    amount_minor: payout.amountMinor,
    amount: formatMinor(payout.amountMinor),
    currency: payout.currency,
    destination: payout.destination,
    failure_code: payout.failureCode,
    created_at: payout.createdAt,
    updated_at: payout.updatedAt,
  };
}

export function serializeDispute(dispute: DisputeRow) {
  return {
    object: "dispute" as const,
    id: dispute.id,
    payment_id: dispute.paymentId,
    status: dispute.status,
    amount_minor: dispute.amountMinor,
    amount: formatMinor(dispute.amountMinor),
    reason: dispute.reason,
    note: dispute.note,
    created_at: dispute.createdAt,
    resolved_at: dispute.resolvedAt,
  };
}

export function serializeWebhookEndpoint(endpoint: WebhookEndpointRow) {
  return {
    object: "webhook_endpoint" as const,
    id: endpoint.id,
    url: endpoint.url,
    description: endpoint.description,
    status: endpoint.status,
    created_at: endpoint.createdAt,
  };
}

export function serializeWebhookEvent(event: WebhookEventRow) {
  return {
    object: "webhook_event" as const,
    id: event.id,
    type: event.type,
    status: event.status,
    attempts: event.attempts,
    last_error: event.lastError,
    payload: JSON.parse(event.payload) as unknown,
    created_at: event.createdAt,
    updated_at: event.updatedAt,
  };
}

export function serializeWebhookDelivery(delivery: WebhookDeliveryRow) {
  return {
    object: "webhook_delivery" as const,
    id: delivery.id,
    event_id: delivery.eventId,
    endpoint_id: delivery.endpointId,
    attempt: delivery.attempt,
    status: delivery.status,
    response_status: delivery.responseStatus,
    response_body: delivery.responseBody,
    error: delivery.error,
    created_at: delivery.createdAt,
  };
}
