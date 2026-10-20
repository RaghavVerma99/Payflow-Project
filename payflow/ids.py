import secrets


def new_id(prefix: str) -> str:
    """Prefixed, non-sequential public identifier (96 bits of entropy)."""
    return f"{prefix}_{secrets.token_hex(12)}"
