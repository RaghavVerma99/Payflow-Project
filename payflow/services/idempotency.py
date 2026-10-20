from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from ..errors import IdempotencyConflict, IdempotencyInProgress
from ..ids import new_id
from ..models import IdempotencyRecord
from ..timeutil import utcnow


def canonical_hash(payload: dict) -> str:
    """Stable hash over semantically relevant fields only."""
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode()).hexdigest()


@dataclass(frozen=True)
class Replay:
    status_code: int
    body: dict


def _replay(record: IdempotencyRecord) -> Replay:
    return Replay(
        status_code=record.response_status or 200,
        body=json.loads(record.response_body or "{}"),
    )


def claim(
    session,
    *,
    merchant_id: str,
    operation: str,
    key: str,
    request_hash: str,
    ttl_hours: int,
) -> tuple[IdempotencyRecord | None, Replay | None]:
    """Atomically claim a key.

    Returns (new_record, None) for the winner and (None, Replay) for a completed
    duplicate. Raises on payload conflict or an in-flight duplicate.
    """
    now = utcnow()
    existing = session.scalar(
        select(IdempotencyRecord).where(
            IdempotencyRecord.merchant_id == merchant_id,
            IdempotencyRecord.operation == operation,
            IdempotencyRecord.idempotency_key == key,
        )
    )

    if existing is not None and existing.expires_at <= now:
        session.delete(existing)
        session.flush()
        existing = None

    if existing is not None:
        return _existing_result(existing, request_hash)

    record = IdempotencyRecord(
        id=new_id("idem"),
        merchant_id=merchant_id,
        operation=operation,
        idempotency_key=key,
        request_hash=request_hash,
        status="in_progress",
        expires_at=now + timedelta(hours=ttl_hours),
    )

    try:
        with session.begin_nested():
            session.add(record)
            session.flush()
    except IntegrityError:
        # Another request won the unique-constraint race. Read its row.
        session.expire_all()
        existing = session.scalar(
            select(IdempotencyRecord).where(
                IdempotencyRecord.merchant_id == merchant_id,
                IdempotencyRecord.operation == operation,
                IdempotencyRecord.idempotency_key == key,
            )
        )
        if existing is None:
            raise
        return _existing_result(existing, request_hash)

    return record, None


def _existing_result(
    record: IdempotencyRecord, request_hash: str
) -> tuple[None, Replay]:
    if record.request_hash != request_hash:
        raise IdempotencyConflict(
            "This idempotency key was previously used with a different request."
        )
    if record.status == "completed":
        return None, _replay(record)
    raise IdempotencyInProgress()


def complete(
    session,
    record: IdempotencyRecord,
    *,
    status_code: int,
    body: dict,
    resource_id: str | None = None,
) -> None:
    record.status = "completed"
    record.response_status = status_code
    record.response_body = json.dumps(body, sort_keys=True, separators=(",", ":"))
    record.resource_id = resource_id
