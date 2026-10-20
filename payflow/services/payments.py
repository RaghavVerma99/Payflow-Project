from __future__ import annotations

from sqlalchemy import and_, func, or_, select, update

from ..errors import Conflict, ErrorCode, NotFound
from ..ids import new_id
from ..models import Payment, PaymentAttempt, PaymentEvent
from ..pagination import decode_cursor, encode_cursor
from ..state_machine import PaymentStatus
from ..timeutil import utcnow
from . import jobs

REFUNDABLE_STATUSES = (PaymentStatus.succeeded, PaymentStatus.partially_refunded)


def create_payment(
    session,
    *,
    merchant_id: str,
    amount: int,
    currency: str,
    customer_id: str | None,
    description: str | None,
    scenario: str,
) -> Payment:
    payment = Payment(
        id=new_id("pay"),
        merchant_id=merchant_id,
        amount_minor=amount,
        currency=currency,
        status=PaymentStatus.created,
        customer_id=customer_id,
        description=description,
    )
    session.add(payment)
    session.flush()
    add_event(session, payment, "payment.created", None, payment.status, "api")
    jobs.enqueue(
        session,
        kind="process_payment",
        payload={"payment_id": payment.id, "scenario": scenario},
        aggregate_id=payment.id,
    )
    return payment


def get_payment(session, *, merchant_id: str, payment_id: str) -> Payment:
    payment = session.scalar(
        select(Payment).where(Payment.id == payment_id, Payment.merchant_id == merchant_id)
    )
    if payment is None:
        # Same response whether it does not exist or belongs to someone else.
        raise NotFound("Payment not found.")
    return payment


def list_payments(
    session,
    *,
    merchant_id: str,
    status: str | None,
    limit: int,
    starting_after: str | None,
) -> tuple[list[Payment], bool, str | None]:
    statement = select(Payment).where(Payment.merchant_id == merchant_id)

    if status is not None:
        if status not in set(PaymentStatus):
            from ..errors import BadRequest

            raise BadRequest(
                f"Unknown status filter '{status}'.", code=ErrorCode.invalid_request
            )
        statement = statement.where(Payment.status == status)

    if starting_after:
        created_at, object_id = decode_cursor(starting_after)
        statement = statement.where(
            or_(
                Payment.created_at < created_at,
                and_(Payment.created_at == created_at, Payment.id < object_id),
            )
        )

    statement = statement.order_by(Payment.created_at.desc(), Payment.id.desc()).limit(limit + 1)
    rows = list(session.scalars(statement))

    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = encode_cursor(rows[-1].created_at, rows[-1].id) if has_more and rows else None
    return rows, has_more, next_cursor


def cancel_payment(session, *, merchant_id: str, payment_id: str) -> Payment:
    payment = get_payment(session, merchant_id=merchant_id, payment_id=payment_id)

    attempt_exists = session.scalar(
        select(func.count())
        .select_from(PaymentAttempt)
        .where(PaymentAttempt.payment_id == payment.id)
    )
    if attempt_exists:
        raise Conflict(
            "A processor attempt has already started; this payment cannot be canceled.",
            code=ErrorCode.invalid_transition,
        )

    now = utcnow()
    result = session.execute(
        update(Payment)
        .where(Payment.id == payment.id, Payment.status == PaymentStatus.created)
        .values(status=PaymentStatus.canceled, updated_at=now)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        raise Conflict(
            "This payment is no longer cancelable.", code=ErrorCode.invalid_transition
        )

    jobs.cancel_for_aggregate(session, payment.id)
    session.refresh(payment)
    add_event(session, payment, "payment.canceled", PaymentStatus.created, payment.status, "api")
    return payment


def add_event(
    session,
    payment: Payment,
    event_type: str,
    from_status: str | None,
    to_status: str,
    reason: str | None,
) -> PaymentEvent:
    event = PaymentEvent(
        id=new_id("evt"),
        payment_id=payment.id,
        type=event_type,
        from_status=from_status,
        to_status=to_status,
        reason=reason,
    )
    session.add(event)
    return event


def list_events(
    session, *, payment: Payment, limit: int, starting_after: str | None
) -> tuple[list[PaymentEvent], bool, str | None]:
    statement = select(PaymentEvent).where(PaymentEvent.payment_id == payment.id)
    if starting_after:
        created_at, object_id = decode_cursor(starting_after)
        statement = statement.where(
            or_(
                PaymentEvent.created_at < created_at,
                and_(PaymentEvent.created_at == created_at, PaymentEvent.id < object_id),
            )
        )
    statement = statement.order_by(
        PaymentEvent.created_at.desc(), PaymentEvent.id.desc()
    ).limit(limit + 1)
    rows = list(session.scalars(statement))
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = encode_cursor(rows[-1].created_at, rows[-1].id) if has_more and rows else None
    return rows, has_more, next_cursor
