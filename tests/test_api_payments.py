from __future__ import annotations

from payflow import db
from payflow.models import Payment


def test_health_endpoints(client):
    assert client.get("/health/live").json() == {"status": "ok"}
    assert client.get("/health/ready").status_code == 200


def test_missing_api_key_is_rejected(client):
    response = client.get("/v1/payments")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"
    assert response.json()["error"]["request_id"].startswith("req_")


def test_invalid_api_key_is_rejected(client):
    response = client.get("/v1/payments", headers={"Authorization": "Bearer sk_test_nope"})
    assert response.status_code == 401


def test_create_payment_returns_202_and_created_state(client, merchant, create_payment):
    response = create_payment()
    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "created"
    assert body["amount"] == 49_900
    assert body["id"].startswith("pay_")
    assert body["created_at"].endswith("Z")


def test_idempotency_key_is_required(client, merchant):
    response = client.post(
        "/v1/payments", headers=merchant["headers"], json={"amount": 100}
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "idempotency_key_required"


def test_invalid_amounts_are_rejected(client, merchant):
    for amount in (0, -100):
        response = client.post(
            "/v1/payments",
            headers={**merchant["headers"], "Idempotency-Key": f"bad-{amount}"},
            json={"amount": amount},
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_request"


def test_unknown_field_is_rejected(client, merchant):
    response = client.post(
        "/v1/payments",
        headers={**merchant["headers"], "Idempotency-Key": "unknown-field"},
        json={"amount": 100, "card_number": "4242424242424242"},
    )
    assert response.status_code == 422


def test_get_unknown_payment_is_404(client, merchant):
    response = client.get("/v1/payments/pay_does_not_exist", headers=merchant["headers"])
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_payment_is_merchant_scoped(client, merchant, other_merchant, create_payment):
    payment = create_payment().json()
    response = client.get(
        f"/v1/payments/{payment['id']}", headers=other_merchant["headers"]
    )
    assert response.status_code == 404


def test_pagination_is_stable(client, merchant, create_payment):
    created = [create_payment(amount=100 + index).json() for index in range(3)]

    first = client.get("/v1/payments?limit=2", headers=merchant["headers"]).json()
    assert len(first["data"]) == 2
    assert first["has_more"] is True

    second = client.get(
        f"/v1/payments?limit=2&starting_after={first['next_cursor']}",
        headers=merchant["headers"],
    ).json()
    assert len(second["data"]) == 1
    assert second["has_more"] is False

    seen = {item["id"] for item in first["data"] + second["data"]}
    assert seen == {payment["id"] for payment in created}


def test_cancel_only_before_processing(client, merchant, create_payment):
    payment = create_payment().json()
    response = client.post(
        f"/v1/payments/{payment['id']}/cancel", headers=merchant["headers"]
    )
    assert response.status_code == 200
    assert response.json()["status"] == "canceled"

    second = client.post(
        f"/v1/payments/{payment['id']}/cancel", headers=merchant["headers"]
    )
    assert second.status_code == 409


def test_cancel_fails_once_an_attempt_exists(client, merchant, create_payment):
    payment = create_payment().json()
    with db.session_scope() as session:
        row = session.get(Payment, payment["id"])
        row.status = "processing"
        session.commit()

    response = client.post(
        f"/v1/payments/{payment['id']}/cancel", headers=merchant["headers"]
    )
    assert response.status_code == 409


def test_request_id_header_is_echoed(client):
    response = client.get("/health/live", headers={"X-Request-ID": "req_custom_123"})
    assert response.headers["X-Request-ID"] == "req_custom_123"


def test_status_filter_rejects_unknown_values(client, merchant):
    response = client.get("/v1/payments?status=banana", headers=merchant["headers"])
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"


def test_payment_events_are_recorded(client, merchant, create_payment, process):
    payment = create_payment().json()
    process()
    events = client.get(
        f"/v1/payments/{payment['id']}/events", headers=merchant["headers"]
    ).json()
    types = [event["type"] for event in events["data"]]
    assert "payment.created" in types
    assert "payment.succeeded" in types


def test_list_is_scoped_to_merchant(client, merchant, other_merchant, create_payment):
    create_payment()
    response = client.get("/v1/payments", headers=other_merchant["headers"])
    assert response.json()["data"] == []
