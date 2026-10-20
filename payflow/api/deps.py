from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

from fastapi import Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import db
from ..config import Settings
from ..errors import Unauthorized
from ..models import ApiKey, Merchant
from ..security import parse_bearer, verify_key


@dataclass(frozen=True)
class Principal:
    merchant_id: str
    api_key_id: str


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_session() -> Iterator[Session]:
    session = db.session_scope()
    try:
        yield session
    finally:
        session.close()


def require_merchant(
    authorization: str | None = Header(default=None),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> Principal:
    raw_key = parse_bearer(authorization)
    prefix = raw_key[:16]
    api_key = session.scalar(select(ApiKey).where(ApiKey.key_prefix == prefix))
    if (
        api_key is None
        or api_key.revoked_at is not None
        or not verify_key(raw_key, api_key.key_hash, settings.api_key_pepper)
    ):
        raise Unauthorized("Invalid API key.")

    merchant = session.get(Merchant, api_key.merchant_id)
    if merchant is None or merchant.status != "active":
        raise Unauthorized("Invalid API key.")

    return Principal(merchant_id=merchant.id, api_key_id=api_key.id)
