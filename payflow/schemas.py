from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .timeutil import iso


class PaymentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: int = Field(
        gt=0,
        le=100_000_000_000,
        description="Minor units, e.g. 49900 = INR 499.00",
    )
    currency: Literal["INR"] = "INR"
    customer_id: str | None = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    description: str | None = Field(default=None, max_length=255)


class RefundCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: int = Field(gt=0, le=100_000_000_000)
    reason: str | None = Field(default=None, max_length=120)


class PaymentOut(BaseModel):
    object: Literal["payment"] = "payment"
    id: str
    status: str
    amount: int
    currency: str
    customer_id: str | None
    description: str | None
    failure_code: str | None
    refunded_amount: int
    created_at: str
    updated_at: str

    @classmethod
    def from_model(cls, payment) -> PaymentOut:  # noqa: ANN001
        return cls(
            id=payment.id,
            status=payment.status,
            amount=payment.amount_minor,
            currency=payment.currency,
            customer_id=payment.customer_id,
            description=payment.description,
            failure_code=payment.failure_code,
            refunded_amount=payment.refunded_minor,
            created_at=iso(payment.created_at),
            updated_at=iso(payment.updated_at),
        )


class RefundOut(BaseModel):
    object: Literal["refund"] = "refund"
    id: str
    payment_id: str
    status: str
    amount: int
    currency: str
    reason: str | None
    failure_code: str | None
    created_at: str
    updated_at: str

    @classmethod
    def from_model(cls, refund) -> RefundOut:  # noqa: ANN001
        return cls(
            id=refund.id,
            payment_id=refund.payment_id,
            status=refund.status,
            amount=refund.amount_minor,
            currency=refund.currency,
            reason=refund.reason,
            failure_code=refund.failure_code,
            created_at=iso(refund.created_at),
            updated_at=iso(refund.updated_at),
        )


class PaymentEventOut(BaseModel):
    object: Literal["event"] = "event"
    id: str
    type: str
    from_status: str | None
    to_status: str
    reason: str | None
    created_at: str

    @classmethod
    def from_model(cls, event) -> PaymentEventOut:  # noqa: ANN001
        return cls(
            id=event.id,
            type=event.type,
            from_status=event.from_status,
            to_status=event.to_status,
            reason=event.reason,
            created_at=iso(event.created_at),
        )


class AccountOut(BaseModel):
    object: Literal["account"] = "account"
    id: str
    code: str
    name: str
    kind: str
    currency: str
    balance: int
    created_at: str


class EntryOut(BaseModel):
    account_id: str
    direction: str
    amount: int
    currency: str


class JournalOut(BaseModel):
    object: Literal["journal"] = "journal"
    id: str
    source_type: str
    source_id: str
    status: str
    currency: str
    created_at: str
    posted_at: str | None
    entries: list[EntryOut]


class PaymentList(BaseModel):
    object: Literal["list"] = "list"
    data: list[PaymentOut]
    has_more: bool
    next_cursor: str | None


class RefundList(BaseModel):
    object: Literal["list"] = "list"
    data: list[RefundOut]
    has_more: bool
    next_cursor: str | None


class EventList(BaseModel):
    object: Literal["list"] = "list"
    data: list[PaymentEventOut]
    has_more: bool
    next_cursor: str | None


class JournalList(BaseModel):
    object: Literal["list"] = "list"
    data: list[JournalOut]
    has_more: bool
    next_cursor: str | None
