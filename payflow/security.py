from __future__ import annotations

import hashlib
import hmac
import secrets

from .errors import Unauthorized

KEY_PREFIX_LENGTH = 16


def hash_key(raw_key: str, pepper: str) -> str:
    return hashlib.sha256(f"{pepper}{raw_key}".encode()).hexdigest()


def generate_api_key(pepper: str) -> tuple[str, str, str]:
    """Return (raw_key, lookup_prefix, hash). The raw key is shown once."""
    raw_key = f"sk_test_{secrets.token_urlsafe(24)}"
    return raw_key, raw_key[:KEY_PREFIX_LENGTH], hash_key(raw_key, pepper)


def verify_key(raw_key: str, stored_hash: str, pepper: str) -> bool:
    return hmac.compare_digest(hash_key(raw_key, pepper), stored_hash)


def parse_bearer(header_value: str | None) -> str:
    if not header_value:
        raise Unauthorized("Missing API key.")
    scheme, _, token = header_value.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise Unauthorized("Invalid authorization header.")
    return token.strip()
