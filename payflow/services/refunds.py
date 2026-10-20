from __future__ import annotations

from sqlalchemy import and_, select, update

from ..errors import Conflict, ErrorCode, NotFound
from ..ids import new_id
from ..models import Payment, Refund
from ..pagination import decode_cursor, encode_cursor
from ..timeutil import utcnow
from . import jobs
from .payments import REFUNDABLE_STATUSES, get_payment


def create_refund(
    session,
    *,
    merchant_id: str,
    payment_id: str,
    amount: int,
    reason: str | None,
    scenario: str,
) -> Refund:
    payment = get_payment(session, merchant_id=merchant_id, payment_id=payment_id)

    # One atomic statement, not a read-then-write. Concurrent refunds cannot
    # both observe the same headroom.
    result = session.execute(
        update(Payment)
        .where(
            Payment.id == payment.id,
            Payment.merchant_id == merchant_id,
            Payment.status.in_(REFUNDABLE_STATUSES),
            Payment.refunded_minor + Payment.refund_reserved_minor + amount
            <= Payment.amount_minor,
        )
        .values(
            refund_reserved_minor=Payment.refund_reserved_minor + amount,
            updated_at=utcnow(),
        )
        .execution_options(synchronize_session=False)
    )

    if result.rowcount != 1:
        session.refresh(payment)
        if payment.status not in REFUNDABLE_STATUSES:
            raise Conflict(
                f"A payment in '{payment.status}' state cannot be refunded.",
                code=ErrorCode.payment_not_refundable,
            )
        raise Conflict(
            "Refund amount exceeds the remaining refundable balance.",
            code=ErrorCode.refund_exceeds_balance,
        )

    session.refresh(payment)
    refund = Refund(
        id=new_id("ref"),
        payment_id=payment.id,
        merchant_id=merchant_id,
        amount_minor=amount,
        currency=payment.currency,
        status="reserved",
        reason=reason,
    )
    session.add(refund)
    session.flush()
    jobs.enqueue(
        session,
        kind="process_refund",
        payload={"refund_id": refund.id, "scenario": scenario},
        aggregate_id=refund.id,
    )
    return refund


def get_refund(session, *, merchant_id: str, refund_id: str) -> Refund:
    refund = session.scalar(
        select(Refund).where(Refund.id == refund_id, Refund.merchant_id == merchant_id)
    )
    if refund is None:
        raise NotFound("Refund not found.")
    return refund


def list_refunds(
    session,
    *,
    merchant_id: str,
    payment_id: str | None,
    limit: int,
    starting_after: str | None,
) -> tuple[list[Refund], bool, str | None]:
    statement = select(Refund).where(Refund.merchant_id == merchant_id)
    if payment_id is not None:
        statement = statement.where(Refund.payment_id == payment_id)

    if starting_after:
        created_at, object_id = decode_cursor(starting_after)
        statement = statement.where(
            (Refund.created_at < created_at)
            | and_(Refund.created_at == created_at, Refund.id < object_id)
        )

    statement = statement.order_by(Refund.created_at.desc(), Refund.id.desc()).limit(limit + 1)
    rows = list(session.scalars(statement))
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = encode_cursor(rows[-1].created_at, rows[-1].id) if has_more and rows else None
    return rows, has_more, next_cursor
