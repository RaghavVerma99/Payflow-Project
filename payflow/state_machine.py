from __future__ import annotations

from enum import StrEnum


class PaymentStatus(StrEnum):
    created = "created"
    processing = "processing"
    succeeded = "succeeded"
    failed = "failed"
    canceled = "canceled"
    unknown = "unknown"
    partially_refunded = "partially_refunded"
    refunded = "refunded"


class AttemptStatus(StrEnum):
    started = "started"
    succeeded = "succeeded"
    declined = "declined"
    timed_out = "timed_out"
    errored = "errored"


# The legal graph. Anything absent is a bug, not a business decision.
ALLOWED: dict[str, frozenset[str]] = {
    PaymentStatus.created: frozenset({PaymentStatus.processing, PaymentStatus.canceled}),
    PaymentStatus.processing: frozenset(
        {PaymentStatus.succeeded, PaymentStatus.failed, PaymentStatus.unknown}
    ),
    # A timeout is not a decline: only reconciliation may resolve an unknown outcome.
    PaymentStatus.unknown: frozenset({PaymentStatus.succeeded, PaymentStatus.failed}),
    PaymentStatus.succeeded: frozenset(
        {PaymentStatus.partially_refunded, PaymentStatus.refunded}
    ),
    PaymentStatus.partially_refunded: frozenset({PaymentStatus.refunded}),
    PaymentStatus.failed: frozenset(),
    PaymentStatus.canceled: frozenset(),
    PaymentStatus.refunded: frozenset(),
}

TERMINAL = frozenset(
    {
        PaymentStatus.succeeded,
        PaymentStatus.failed,
        PaymentStatus.canceled,
        PaymentStatus.refunded,
    }
)


def can_transition(current: str, new: str) -> bool:
    if current == new:
        return False
    return new in ALLOWED.get(current, frozenset())


def assert_transition(current: str, new: str) -> None:
    from .errors import InvalidTransition

    if not can_transition(current, new):
        raise InvalidTransition(f"Cannot move a payment from '{current}' to '{new}'.")


def transition(payment, new: str, reason: str | None = None) -> None:  # noqa: ANN001
    """Mutate the payment after verifying the edge exists. Caller owns the transaction."""
    assert_transition(payment.status, new)
    payment.status = new
