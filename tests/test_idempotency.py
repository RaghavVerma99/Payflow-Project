from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from payflow import db
from payflow.models import IdempotencyRecord, Payment


def _payment_count() -> int:
    with db.session_scope() as session:
        return int(session.scalar(select(func.count()).select_from(Payment)) or 0)


def test_same_key_and_body_replays_the_original_response(client, create_payment):
    first = create_payment(key="shared-key")
    second = create_payment(key="shared-key")

    assert first.status_code == 202
    assert second.status_code == 202
    assert second.headers["Idempotent-Replayed"] == "true"
    assert first.json()["id"] == second.json()["id"]
    assert _payment_count() == 1


def test_same_key_with_different_body_conflicts(client, create_payment):
    create_payment(amount=100, key="conflict-key")
    response = create_payment(amount=200, key="conflict-key")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "idempotency_conflict"
    assert _payment_count() == 1


def test_idempotency_is_scoped_per_merchant(
    client, merchant, other_merchant, create_payment
):
    first = create_payment(amount=100, key="same-key")
    second = create_payment(
        amount=100, key="same-key", headers=other_merchant["headers"]
    )

    assert first.status_code == 202
    assert second.status_code == 202
    assert first.json()["id"] != second.json()["id"]
    assert _payment_count() == 2


def test_key_is_scoped_to_the_operation(client, merchant, create_payment, process):
    payment = create_payment(amount=10_000, key="cross-op").json()
    process()

    refund = client.post(
        f"/v1/payments/{payment['id']}/refunds",
        headers={**merchant["headers"], "Idempotency-Key": "cross-op"},
        json={"amount": 1_000},
    )
    assert refund.status_code == 202


def test_concurrent_duplicates_create_one_payment(app, merchant):
    def submit(_index: int) -> tuple[int, str | None]:
        client = TestClient(app)
        response = client.post(
            "/v1/payments",
            headers={**merchant["headers"], "Idempotency-Key": "concurrent-key"},
            json={"amount": 7_500},
        )
        payment_id = response.json().get("id") if response.status_code == 202 else None
        return response.status_code, payment_id

    with ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(submit, range(5)))

    assert _payment_count() == 1
    successful_ids = {payment_id for status, payment_id in results if status == 202}
    assert len(successful_ids) == 1
    assert all(status in (202, 409) for status, _ in results)

    with db.session_scope() as session:
        records = list(session.scalars(select(IdempotencyRecord)))
    assert len(records) == 1
    assert records[0].status == "completed"
