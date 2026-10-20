from __future__ import annotations

import base64
from datetime import datetime

from .errors import BadRequest, ErrorCode


def encode_cursor(created_at: datetime, object_id: str) -> str:
    raw = f"{created_at.isoformat()}|{object_id}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        padding = "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(cursor + padding).decode()
        timestamp, _, object_id = raw.partition("|")
        return datetime.fromisoformat(timestamp), object_id
    except Exception as exc:  # noqa: BLE001
        raise BadRequest("Invalid pagination cursor.", code=ErrorCode.invalid_request) from exc


def clamp_limit(limit: int | None, *, default: int, maximum: int) -> int:
    if limit is None:
        return default
    if limit < 1:
        raise BadRequest("limit must be at least 1.", code=ErrorCode.invalid_request)
    return min(limit, maximum)
