from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from .. import db
from ..api.deps import Principal, get_session, get_settings, require_merchant
from ..config import Settings
from ..errors import BadRequest, ErrorCode
from ..pagination import clamp_limit
from ..processor import validate_scenario
from ..schemas import RefundCreate, RefundList, RefundOut
from ..services import idempotency, payments, refunds

router = APIRouter(tags=["refunds"])


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


@router.post("/v1/payments/{payment_id}/refunds", status_code=202, response_model=RefundOut)
def create_refund(
    payment_id: str,
    body: RefundCreate,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    simulator_scenario: str | None = Header(default=None, alias="X-Simulator-Scenario"),
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_merchant),
    settings: Settings = Depends(get_settings),
):
    key = _idempotency_key(idempotency_key)
    scenario = _scenario(simulator_scenario, settings)
    operation = f"POST:/v1/payments/{payment_id}/refunds"
    request_hash = idempotency.canonical_hash(
        {"payment_id": payment_id, **body.model_dump()}
    )

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
        refund = refunds.create_refund(
            session,
            merchant_id=principal.merchant_id,
            payment_id=payment_id,
            amount=body.amount,
            reason=body.reason,
            scenario=scenario,
        )
        response_body = RefundOut.from_model(refund).model_dump()
        idempotency.complete(
            session,
            record,
            status_code=202,
            body=response_body,
            resource_id=refund.id,
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


@router.get("/v1/refunds/{refund_id}", response_model=RefundOut)
def get_refund(
    refund_id: str,
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_merchant),
) -> RefundOut:
    refund = refunds.get_refund(
        session, merchant_id=principal.merchant_id, refund_id=refund_id
    )
    return RefundOut.from_model(refund)


@router.get("/v1/refunds", response_model=RefundList)
def list_refunds(
    payment_id: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1),
    starting_after: str | None = Query(default=None),
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_merchant),
    settings: Settings = Depends(get_settings),
) -> RefundList:
    page_size = clamp_limit(
        limit, default=settings.default_page_size, maximum=settings.max_page_size
    )
    rows, has_more, next_cursor = refunds.list_refunds(
        session,
        merchant_id=principal.merchant_id,
        payment_id=payment_id,
        limit=page_size,
        starting_after=starting_after,
    )
    return RefundList(
        data=[RefundOut.from_model(row) for row in rows],
        has_more=has_more,
        next_cursor=next_cursor,
    )


@router.get("/v1/payments/{payment_id}/refunds", response_model=RefundList)
def list_payment_refunds(
    payment_id: str,
    limit: int | None = Query(default=None, ge=1),
    starting_after: str | None = Query(default=None),
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_merchant),
    settings: Settings = Depends(get_settings),
) -> RefundList:
    payments.get_payment(session, merchant_id=principal.merchant_id, payment_id=payment_id)
    page_size = clamp_limit(
        limit, default=settings.default_page_size, maximum=settings.max_page_size
    )
    rows, has_more, next_cursor = refunds.list_refunds(
        session,
        merchant_id=principal.merchant_id,
        payment_id=payment_id,
        limit=page_size,
        starting_after=starting_after,
    )
    return RefundList(
        data=[RefundOut.from_model(row) for row in rows],
        has_more=has_more,
        next_cursor=next_cursor,
    )
