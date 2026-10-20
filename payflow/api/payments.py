from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Query, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from .. import db
from ..api.deps import Principal, get_session, get_settings, require_merchant
from ..config import Settings
from ..errors import BadRequest, ErrorCode
from ..pagination import clamp_limit
from ..processor import validate_scenario
from ..schemas import (
    EventList,
    PaymentCreate,
    PaymentEventOut,
    PaymentList,
    PaymentOut,
)
from ..services import idempotency, payments

router = APIRouter(prefix="/v1/payments", tags=["payments"])


def _idempotency_key(value: str | None) -> str:
    if value is None or not value.strip():
        raise BadRequest(
            "An Idempotency-Key header is required for this operation.",
            code=ErrorCode.idempotency_key_required,
        )
    if not 1 <= len(value) <= 255:
        raise BadRequest(
            "Idempotency-Key must be between 1 and 255 characters.",
            code=ErrorCode.idempotency_key_required,
        )
    return value


def _scenario(value: str | None, settings: Settings) -> str:
    if value is not None and not settings.allow_simulator_controls:
        raise BadRequest(
            "Simulator controls are disabled in this environment.",
            code=ErrorCode.simulator_controls_disabled,
            status_code=403,
        )
    return validate_scenario(value)


@router.post("", status_code=202, response_model=PaymentOut)
def create_payment(
    body: PaymentCreate,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    simulator_scenario: str | None = Header(default=None, alias="X-Simulator-Scenario"),
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_merchant),
    settings: Settings = Depends(get_settings),
) -> Response:
    key = _idempotency_key(idempotency_key)
    scenario = _scenario(simulator_scenario, settings)
    payload = body.model_dump()
    request_hash = idempotency.canonical_hash(payload)
    operation = "POST:/v1/payments"

    def work():
        record, replay = idempotency.claim(
            session,
            merchant_id=principal.merchant_id,
            operation=operation,
            key=key,
            request_hash=request_hash,
            ttl_hours=settings.idempotency_ttl_hours,
        )
        if replay is not None:
            return replay
        payment = payments.create_payment(
            session,
            merchant_id=principal.merchant_id,
            amount=body.amount,
            currency=body.currency,
            customer_id=body.customer_id,
            description=body.description,
            scenario=scenario,
        )
        response_body = PaymentOut.from_model(payment).model_dump()
        idempotency.complete(
            session,
            record,
            status_code=202,
            body=response_body,
            resource_id=payment.id,
        )
        return response_body

    result = db.run_with_retry(session, work)
    if isinstance(result, idempotency.Replay):
        return JSONResponse(
            status_code=result.status_code,
            content=result.body,
            headers={"Idempotent-Replayed": "true"},
        )
    return JSONResponse(status_code=202, content=result)


@router.get("", response_model=PaymentList)
def list_payments(
    status: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1),
    starting_after: str | None = Query(default=None),
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_merchant),
    settings: Settings = Depends(get_settings),
) -> PaymentList:
    page_size = clamp_limit(
        limit, default=settings.default_page_size, maximum=settings.max_page_size
    )
    rows, has_more, next_cursor = payments.list_payments(
        session,
        merchant_id=principal.merchant_id,
        status=status,
        limit=page_size,
        starting_after=starting_after,
    )
    return PaymentList(
        data=[PaymentOut.from_model(row) for row in rows],
        has_more=has_more,
        next_cursor=next_cursor,
    )


@router.get("/{payment_id}", response_model=PaymentOut)
def get_payment(
    payment_id: str,
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_merchant),
) -> PaymentOut:
    payment = payments.get_payment(
        session, merchant_id=principal.merchant_id, payment_id=payment_id
    )
    return PaymentOut.from_model(payment)


@router.post("/{payment_id}/cancel", response_model=PaymentOut)
def cancel_payment(
    payment_id: str,
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_merchant),
) -> PaymentOut:
    payment = payments.cancel_payment(
        session, merchant_id=principal.merchant_id, payment_id=payment_id
    )
    session.commit()
    return PaymentOut.from_model(payment)


@router.get("/{payment_id}/events", response_model=EventList)
def list_payment_events(
    payment_id: str,
    limit: int | None = Query(default=None, ge=1),
    starting_after: str | None = Query(default=None),
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_merchant),
    settings: Settings = Depends(get_settings),
) -> EventList:
    payment = payments.get_payment(
        session, merchant_id=principal.merchant_id, payment_id=payment_id
    )
    page_size = clamp_limit(
        limit, default=settings.default_page_size, maximum=settings.max_page_size
    )
    rows, has_more, next_cursor = payments.list_events(
        session, payment=payment, limit=page_size, starting_after=starting_after
    )
    return EventList(
        data=[PaymentEventOut.from_model(row) for row in rows],
        has_more=has_more,
        next_cursor=next_cursor,
    )
