from __future__ import annotations

import uuid
from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from payflow import db
from payflow.config import Settings
from payflow.main import create_app
from payflow.seed import create_merchant
from payflow.worker import drain


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        environment="test",
        database_url=f"sqlite+pysqlite:///{tmp_path / 'test.db'}",
        worker_enabled=False,
        worker_poll_interval=0.01,
        max_job_attempts=3,
    )


@pytest.fixture
def app(settings: Settings):
    return create_app(settings)


@pytest.fixture
def client(app) -> TestClient:
    return TestClient(app)


@pytest.fixture
def merchant(app, settings: Settings) -> dict:
    with db.session_scope() as session:
        merchant, raw_key = create_merchant(
            session, name="Test Merchant", pepper=settings.api_key_pepper
        )
    return {
        "id": merchant.id,
        "key": raw_key,
        "headers": {"Authorization": f"Bearer {raw_key}"},
    }


@pytest.fixture
def other_merchant(app, settings: Settings) -> dict:
    with db.session_scope() as session:
        merchant, raw_key = create_merchant(
            session, name="Other Merchant", pepper=settings.api_key_pepper
        )
    return {
        "id": merchant.id,
        "key": raw_key,
        "headers": {"Authorization": f"Bearer {raw_key}"},
    }


@pytest.fixture
def process(settings: Settings) -> Callable[[], int]:
    def _drain() -> int:
        return drain(settings)

    return _drain


@pytest.fixture
def create_payment(client: TestClient, merchant: dict) -> Callable[..., dict]:
    def _create(
        amount: int = 49_900,
        *,
        scenario: str | None = None,
        key: str | None = None,
        headers: dict | None = None,
    ) -> dict:
        request_headers = dict(headers or merchant["headers"])
        request_headers["Idempotency-Key"] = key or uuid.uuid4().hex
        if scenario:
            request_headers["X-Simulator-Scenario"] = scenario
        response = client.post(
            "/v1/payments",
            headers=request_headers,
            json={"amount": amount, "customer_id": "cus_demo_1", "description": "test"},
        )
        return response

    return _create
