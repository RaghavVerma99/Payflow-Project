from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select

from payflow import db
from payflow.models import Job, Payment, PaymentAttempt
from payflow.timeutil import utcnow
from payflow.worker import drain


def _force_next_run(kind: str) -> None:
    with db.session_scope() as session:
        job = session.scalar(select(Job).where(Job.kind == kind))
        assert job is not None
        job.next_run_at = utcnow()
        session.commit()


def _journal_count() -> int:
    from payflow.models import LedgerTransaction

    with db.session_scope() as session:
        return len(list(session.scalars(select(LedgerTransaction))))


def test_approved_payment_posts_one_balanced_journal(
    client, merchant, create_payment, process
):
    payment = create_payment().json()
    assert process() == 1

    updated = client.get(f"/v1/payments/{payment['id']}", headers=merchant["headers"]).json()
    assert updated["status"] == "succeeded"
    assert _journal_count() == 1

    accounts = client.get("/v1/accounts", headers=merchant["headers"]).json()
    balances = {account["code"]: account["balance"] for account in accounts}
    assert balances == {"merchant_payable": 49_900, "processor_clearing": 49_900}


def test_declined_payment_does_not_post_a_journal(
    client, merchant, create_payment, process
):
    payment = create_payment(scenario="decline").json()
    process()

    updated = client.get(f"/v1/payments/{payment['id']}", headers=merchant["headers"]).json()
    assert updated["status"] == "failed"
    assert updated["failure_code"] == "card_declined"
    assert _journal_count() == 0

    with db.session_scope() as session:
        attempt = session.scalar(
            select(PaymentAttempt).where(PaymentAttempt.payment_id == payment["id"])
        )
        assert attempt.status == "declined"


def test_timeout_is_unknown_then_reconciled(
    client, merchant, create_payment, process, settings
):
    payment = create_payment(scenario="timeout").json()
    assert process() == 1

    unknown = client.get(f"/v1/payments/{payment['id']}", headers=merchant["headers"]).json()
    assert unknown["status"] == "unknown"
    assert _journal_count() == 0

    _force_next_run("reconcile_payment")
    assert drain(settings) >= 1

    resolved = client.get(f"/v1/payments/{payment['id']}", headers=merchant["headers"]).json()
    assert resolved["status"] == "succeeded"
    assert _journal_count() == 1


def test_transient_error_retries_then_succeeds(
    client, merchant, create_payment, process, settings
):
    payment = create_payment(scenario="transient").json()
    assert process() == 1

    with db.session_scope() as session:
        job = session.scalar(select(Job).where(Job.kind == "process_payment"))
        assert job.status == "retrying"
        assert job.attempts == 1

    _force_next_run("process_payment")
    assert process() >= 1

    updated = client.get(f"/v1/payments/{payment['id']}", headers=merchant["headers"]).json()
    assert updated["status"] == "succeeded"

    with db.session_scope() as session:
        attempts = list(
            session.scalars(
                select(PaymentAttempt)
                .where(PaymentAttempt.payment_id == payment["id"])
                .order_by(PaymentAttempt.attempt_number)
            )
        )
    assert [attempt.status for attempt in attempts] == ["errored", "succeeded"]


def test_reprocessing_a_succeeded_payment_does_not_double_post(
    client, merchant, create_payment, process, settings
):
    payment = create_payment().json()
    process()
    assert _journal_count() == 1

    with db.session_scope() as session:
        session.add(
            Job(
                id="job_manual_replay",
                kind="process_payment",
                aggregate_id=payment["id"],
                payload={"payment_id": payment["id"], "scenario": "approve"},
                status="pending",
                attempts=0,
                max_attempts=3,
                next_run_at=utcnow() - timedelta(seconds=1),
            )
        )
        session.commit()

    process()
    assert _journal_count() == 1

    with db.session_scope() as session:
        replay_job = session.get(Job, "job_manual_replay")
        assert replay_job.status == "dead"
        payment_row = session.get(Payment, payment["id"])
        assert payment_row.status == "succeeded"
