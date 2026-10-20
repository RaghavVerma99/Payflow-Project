from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from payflow import db
from payflow.models import LedgerTransaction, Payment, Refund


def _refund(client, merchant, payment_id, amount, *, key, scenario=None, headers=None):
    request_headers = dict(headers or merchant["headers"])
    request_headers["Idempotency-Key"] = key
    if scenario:
        request_headers["X-Simulator-Scenario"] = scenario
    return client.post(
        f"/v1/payments/{payment_id}/refunds",
        headers=request_headers,
        json={"amount": amount, "reason": "customer_request"},
    )


def _succeeded_payment(create_payment, process, amount=49_900) -> dict:
    payment = create_payment(amount=amount).json()
    process()
    return payment


def test_partial_refund_then_full_refund(client, merchant, create_payment, process):
    payment = _succeeded_payment(create_payment, process)

    first = _refund(client, merchant, payment["id"], 12_000, key="refund-1")
    assert first.status_code == 202
    assert first.json()["status"] == "reserved"
    process()

    partially = client.get(
        f"/v1/payments/{payment['id']}", headers=merchant["headers"]
    ).json()
    assert partially["status"] == "partially_refunded"
    assert partially["refunded_amount"] == 12_000

    second = _refund(client, merchant, payment["id"], 37_900, key="refund-2")
    assert second.status_code == 202
    process()

    refunded = client.get(
        f"/v1/payments/{payment['id']}", headers=merchant["headers"]
    ).json()
    assert refunded["status"] == "refunded"
    assert refunded["refunded_amount"] == 49_900

    accounts = client.get("/v1/accounts", headers=merchant["headers"]).json()
    balances = {account["code"]: account["balance"] for account in accounts}
    assert balances == {"merchant_payable": 0, "processor_clearing": 0}


def test_refund_over_remaining_balance_is_rejected(
    client, merchant, create_payment, process
):
    payment = _succeeded_payment(create_payment, process)

    response = _refund(client, merchant, payment["id"], 50_000, key="too-much")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "refund_exceeds_balance"

    with db.session_scope() as session:
        row = session.get(Payment, payment["id"])
        assert row.refund_reserved_minor == 0


def test_refund_on_failed_payment_is_rejected(client, merchant, create_payment, process):
    payment = create_payment(scenario="decline").json()
    process()

    response = _refund(client, merchant, payment["id"], 1_000, key="not-refundable")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "payment_not_refundable"


def test_refund_replay_returns_the_same_refund(client, merchant, create_payment, process):
    payment = _succeeded_payment(create_payment, process)

    first = _refund(client, merchant, payment["id"], 5_000, key="refund-replay")
    second = _refund(client, merchant, payment["id"], 5_000, key="refund-replay")

    assert first.json()["id"] == second.json()["id"]
    assert second.headers["Idempotent-Replayed"] == "true"

    with db.session_scope() as session:
        count = session.scalar(select(func.count()).select_from(Refund))
    assert count == 1


def test_declined_refund_releases_the_reservation(
    client, merchant, create_payment, process
):
    payment = _succeeded_payment(create_payment, process)

    response = _refund(
        client, merchant, payment["id"], 20_000, key="declined-refund", scenario="decline"
    )
    process()

    refund = client.get(
        f"/v1/refunds/{response.json()['id']}", headers=merchant["headers"]
    ).json()
    assert refund["status"] == "failed"

    with db.session_scope() as session:
        row = session.get(Payment, payment["id"])
        assert row.refund_reserved_minor == 0
        assert row.refunded_minor == 0

    # Capacity is available again.
    retry = _refund(client, merchant, payment["id"], 49_900, key="full-again")
    assert retry.status_code == 202


def test_two_concurrent_refunds_cannot_exceed_the_payment(
    app, client, merchant, create_payment, process
):
    payment = _succeeded_payment(create_payment, process, amount=49_900)

    def submit(index: int) -> int:
        http = TestClient(app)
        return _refund(
            http, merchant, payment["id"], 40_000, key=f"concurrent-refund-{index}"
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(submit, range(2)))

    assert sorted(statuses) == [202, 409]

    with db.session_scope() as session:
        row = session.get(Payment, payment["id"])
        assert row.refund_reserved_minor == 40_000
        assert row.refund_reserved_minor <= row.amount_minor


def test_refund_posts_a_compensating_journal(client, merchant, create_payment, process):
    payment = _succeeded_payment(create_payment, process)
    _refund(client, merchant, payment["id"], 10_000, key="journal-refund")
    process()

    with db.session_scope() as session:
        journals = list(
            session.scalars(
                select(LedgerTransaction).order_by(LedgerTransaction.created_at)
            )
        )
    assert [journal.source_type for journal in journals] == ["payment", "refund"]
    assert journals[0].id != journals[1].id
