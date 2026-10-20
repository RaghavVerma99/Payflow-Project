"""Create synthetic merchants and print their test API keys once.

    uv run python -m payflow.seed
"""

from __future__ import annotations

import argparse
import json
import sys

from . import db
from .config import Settings
from .ids import new_id
from .models import ApiKey, Merchant
from .security import generate_api_key


def create_merchant(session, *, name: str, pepper: str) -> tuple[Merchant, str]:
    merchant = Merchant(id=new_id("mer"), name=name, status="active")
    raw_key, prefix, key_hash = generate_api_key(pepper)
    session.add(merchant)
    session.flush()
    session.add(
        ApiKey(
            id=new_id("key"),
            merchant_id=merchant.id,
            key_prefix=prefix,
            key_hash=key_hash,
        )
    )
    session.commit()
    return merchant, raw_key


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed demo merchants for PayFlow")
    parser.add_argument(
        "--name",
        action="append",
        dest="names",
        help="Merchant name; repeat for multiple merchants.",
    )
    args = parser.parse_args()

    names = args.names or ["Acme Store", "Beta Goods"]
    settings = Settings()
    db.configure(settings.database_url)
    db.init_db()

    output = []
    with db.session_scope() as session:
        for name in names:
            merchant, raw_key = create_merchant(
                session, name=name, pepper=settings.api_key_pepper
            )
            output.append({"merchant_id": merchant.id, "name": name, "api_key": raw_key})

    print(json.dumps(output, indent=2))
    print("\nStore these keys now; only the hash is persisted.", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
