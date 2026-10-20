"""Durable job worker.

Every handler is safe to run twice: business effects are guarded by unique
constraints and explicit state checks, so a crash between the side effect and
job completion does not double-post money.
"""

from __future__ import annotations

import logging
import os
import secrets
import threading
from datetime import timedelta

from sqlalchemy import func, select, update

from . import db
from .config import Settings
from .ids import new_id
from .models import Payment, PaymentAttempt, Refund
from .processor import Outcome, Simulator, validate_scenario
from .services import jobs, ledger, payments
from .state_machine import PaymentStatus, transition
from .timeutil import utcnow

logger = logging.getLogger("payflow.worker")
SIMULATOR = Simulator()


class RetryableJobError(Exception):
    pass


class PermanentJobError(Exception):
    pass


def run_once(settings: Settings, *, worker_id: str | None = None) -> bool:
    """Claim and execute at most one due job. Returns False when idle."""
    worker_id = worker_id or f"worker_{os.getpid()}_{secrets.token_hex(3)}"

    with db.session_scope() as session:
        recovered = jobs.recover_expired(session)
        if recovered:
            logger.warning("recovered %s expired job lease(s)", recovered)
        job = jobs.claim_next(
            session, worker_id=worker_id, lease_seconds=settings.worker_lease_seconds
        )
        session.commit()
        if job is None:
            return False
        job_id, kind, payload = job.id, job.kind, dict(job.payload)

    _execute(job_id, kind, payload, settings)
    return True


def drain(settings: Settings, *, max_jobs: int = 500) -> int:
    """Process all currently-due jobs. Used by tests and `--once`."""
    processed = 0
    while processed < max_jobs and run_once(settings):
        processed += 1
    return processed


def _execute(job_id: str, kind: str, payload: dict, settings: Settings) -> None:
    try:
        if kind == "process_payment":
            _process_payment(payload, settings)
        elif kind == "reconcile_payment":
            _reconcile_payment(payload, settings)
        elif kind == "process_refund":
            _process_refund(payload, settings)
        else:
            raise PermanentJobError(f"Unknown job kind: {kind}")
    except RetryableJobError as exc:
        _fail(job_id, str(exc), retryable=True)
    except PermanentJobError as exc:
        _fail(job_id, str(exc), retryable=False)
    except Exception as exc:  # noqa: BLE001
        logger.exception("job %s failed", job_id)
        _fail(job_id, f"{type(exc).__name__}: {exc}", retryable=True)
    else:
        with db.session_scope() as session:
            jobs.mark_succeeded(session, job_id)
            session.commit()


def _fail(job_id: str, error: str, *, retryable: bool) -> None:
    with db.session_scope() as session:
        jobs.mark_failed(session, job_id, error, retryable=retryable)
        session.commit()
    logger.warning("job %s failed (retryable=%s): %s", job_id, retryable, error)


def _process_payment(payload: dict, settings: Settings) -> None:
    payment_id = payload["payment_id"]
    scenario = validate_scenario(payload.get("scenario"))

    attempt_id, reference, attempt_number = _begin_attempt(payment_id, scenario)

    result = SIMULATOR.process(
        reference=reference,
        scenario=scenario,
        attempt_number=attempt_number,
        amount_minor=payload.get("amount_minor", 0),
    )

    retry_error: str | None = None
    with db.session_scope() as session:
        payment = session.get(Payment, payment_id)
        attempt = session.get(PaymentAttempt, attempt_id)
        if payment is None or attempt is None:
            raise PermanentJobError("Payment or attempt disappeared.")
        if payment.status not in (PaymentStatus.created, PaymentStatus.processing):
            return  # canceled or already resolved while we simulated

        now = utcnow()
        if result.outcome is Outcome.succeeded:
            attempt.status = "succeeded"
            attempt.finished_at = now
            transition(payment, PaymentStatus.succeeded)
            _post_payment_journal(session, payment)
            payments.add_event(
                session, payment, "payment.succeeded", PaymentStatus.processing,
                payment.status, "processor_approved",
            )
        elif result.outcome is Outcome.declined:
            attempt.status = "declined"
            attempt.failure_code = result.failure_code
            attempt.finished_at = now
            payment.failure_code = result.failure_code
            transition(payment, PaymentStatus.failed)
            payments.add_event(
                session, payment, "payment.failed", PaymentStatus.processing,
                payment.status, result.failure_code,
            )
        elif result.outcome is Outcome.timeout:
            attempt.status = "timed_out"
            attempt.finished_at = now
            transition(payment, PaymentStatus.unknown)
            payments.add_event(
                session, payment, "payment.unknown", PaymentStatus.processing,
                payment.status, "processor_timeout",
            )
            jobs.enqueue(
                session,
                kind="reconcile_payment",
                payload={
                    "payment_id": payment.id,
                    "attempt_id": attempt.id,
                    "scenario": scenario,
                },
                aggregate_id=payment.id,
                run_at=now + timedelta(seconds=2),
                max_attempts=settings.max_job_attempts,
            )
        else:
            attempt.status = "errored"
            attempt.failure_code = result.failure_code
            attempt.finished_at = now
            payments.add_event(
                session, payment, "payment.attempt_errored", PaymentStatus.processing,
                payment.status, result.failure_code,
            )
            retry_error = result.failure_code or "processor_error"

        session.commit()

    if retry_error:
        raise RetryableJobError(retry_error)


def _begin_attempt(payment_id: str, scenario: str) -> tuple[str, str, int]:
    now = utcnow()
    with db.session_scope() as session:
        payment = session.get(Payment, payment_id)
        if payment is None:
            raise PermanentJobError(f"Payment {payment_id} not found.")
        if payment.status not in (PaymentStatus.created, PaymentStatus.processing):
            raise PermanentJobError(
                f"Payment {payment_id} is {payment.status}; nothing to process."
            )

        # A retried job must not leave the previous attempt hanging.
        session.execute(
            update(PaymentAttempt)
            .where(
                PaymentAttempt.payment_id == payment_id,
                PaymentAttempt.status == "started",
            )
            .values(status="errored", finished_at=now)
            .execution_options(synchronize_session=False)
        )

        last_number = session.scalar(
            select(func.max(PaymentAttempt.attempt_number)).where(
                PaymentAttempt.payment_id == payment_id
            )
        )
        attempt_number = int(last_number or 0) + 1
        attempt_id = new_id("att")
        reference = new_id("proc")
        session.add(
            PaymentAttempt(
                id=attempt_id,
                payment_id=payment_id,
                attempt_number=attempt_number,
                status="started",
                processor_reference=reference,
                started_at=now,
            )
        )
        if payment.status == PaymentStatus.created:
            transition(payment, PaymentStatus.processing)
            payments.add_event(
                session, payment, "payment.processing", PaymentStatus.created,
                payment.status, "worker_claimed",
            )
        session.commit()

    return attempt_id, reference, attempt_number


def _reconcile_payment(payload: dict, settings: Settings) -> None:
    del settings
    payment_id = payload["payment_id"]
    attempt_id = payload["attempt_id"]
    scenario = validate_scenario(payload.get("scenario"))

    with db.session_scope() as session:
        payment = session.get(Payment, payment_id)
        attempt = session.get(PaymentAttempt, attempt_id)
        if payment is None or attempt is None:
            raise PermanentJobError("Payment or attempt disappeared.")
        if payment.status != PaymentStatus.unknown:
            return  # resolved by someone else
        reference = attempt.processor_reference

    result = SIMULATOR.lookup(reference=reference, scenario=scenario)
    if result.outcome not in (Outcome.succeeded, Outcome.declined):
        raise RetryableJobError("Processor still cannot resolve the outcome.")

    with db.session_scope() as session:
        payment = session.get(Payment, payment_id)
        attempt = session.get(PaymentAttempt, attempt_id)
        if payment is None or attempt is None:
            raise PermanentJobError("Payment or attempt disappeared.")
        if payment.status != PaymentStatus.unknown:
            return

        now = utcnow()
        if result.outcome is Outcome.succeeded:
            attempt.status = "succeeded"
            attempt.finished_at = now
            transition(payment, PaymentStatus.succeeded)
            _post_payment_journal(session, payment)
            event_type, reason = "payment.succeeded", "reconciled_approved"
        else:
            attempt.status = "declined"
            attempt.failure_code = result.failure_code
            attempt.finished_at = now
            payment.failure_code = result.failure_code
            transition(payment, PaymentStatus.failed)
            event_type, reason = "payment.failed", "reconciled_declined"

        payments.add_event(
            session, payment, event_type, PaymentStatus.unknown, payment.status, reason
        )
        session.commit()


def _process_refund(payload: dict, settings: Settings) -> None:
    refund_id = payload["refund_id"]
    scenario = validate_scenario(payload.get("scenario"))

    with db.session_scope() as session:
        refund = session.get(Refund, refund_id)
        if refund is None:
            raise PermanentJobError(f"Refund {refund_id} not found.")
        if refund.status in ("succeeded", "failed", "canceled"):
            return
        if refund.status == "reserved":
            refund.status = "processing"
            refund.processor_reference = new_id("proc")
            session.commit()
        reference = refund.processor_reference

    result = SIMULATOR.process(
        reference=reference or new_id("proc"),
        scenario=scenario,
        attempt_number=1,
        amount_minor=0,
    )

    if result.outcome in (Outcome.timeout, Outcome.error):
        raise RetryableJobError(result.failure_code or "refund_processor_error")

    with db.session_scope() as session:
        refund = session.get(Refund, refund_id)
        if refund is None:
            raise PermanentJobError(f"Refund {refund_id} not found.")
        if refund.status != "processing":
            return

        payment = session.get(Payment, refund.payment_id)
        if payment is None:
            raise PermanentJobError("Refund points at a missing payment.")
        if payment.refund_reserved_minor < refund.amount_minor:
            raise PermanentJobError("Refund reservation underflow.")

        now = utcnow()
        if result.outcome is Outcome.succeeded:
            payment.refund_reserved_minor -= refund.amount_minor
            payment.refunded_minor += refund.amount_minor

            new_status = (
                PaymentStatus.refunded
                if payment.refunded_minor == payment.amount_minor
                else PaymentStatus.partially_refunded
            )
            if payment.status != new_status:
                transition(payment, new_status)

            _post_refund_journal(session, payment, refund)
            refund.status = "succeeded"
            refund.processor_reference = reference
            payments.add_event(
                session, payment, "refund.succeeded", PaymentStatus.succeeded,
                payment.status, refund.id,
            )
        else:
            payment.refund_reserved_minor -= refund.amount_minor
            refund.status = "failed"
            refund.failure_code = result.failure_code
            refund.processor_reference = reference
            payments.add_event(
                session, payment, "refund.failed", payment.status, payment.status,
                refund.id,
            )

        refund.updated_at = now
        session.commit()


def _post_payment_journal(session, payment: Payment) -> None:
    accounts = ledger.ensure_accounts(session, payment.merchant_id)
    ledger.post_journal(
        session,
        source_type="payment",
        source_id=payment.id,
        currency=payment.currency,
        entries=[
            (accounts["processor_clearing"], "debit", payment.amount_minor),
            (accounts["merchant_payable"], "credit", payment.amount_minor),
        ],
    )


def _post_refund_journal(session, payment: Payment, refund: Refund) -> None:
    accounts = ledger.ensure_accounts(session, payment.merchant_id)
    ledger.post_journal(
        session,
        source_type="refund",
        source_id=refund.id,
        currency=refund.currency,
        entries=[
            (accounts["merchant_payable"], "debit", refund.amount_minor),
            (accounts["processor_clearing"], "credit", refund.amount_minor),
        ],
    )


class WorkerThread(threading.Thread):
    """Single in-process worker. A separate process can run the same loop."""

    def __init__(self, settings: Settings) -> None:
        super().__init__(name="payflow-worker", daemon=True)
        self.settings = settings
        self._stop = threading.Event()

    def run(self) -> None:
        while not self._stop.is_set():
            try:
                worked = run_once(self.settings)
            except Exception:  # noqa: BLE001
                logger.exception("worker loop error")
                worked = False
            if not worked:
                self._stop.wait(self.settings.worker_poll_interval)

    def stop(self) -> None:
        self._stop.set()


def main() -> None:
    import argparse
    import time

    parser = argparse.ArgumentParser(description="PayFlow background worker")
    parser.add_argument("--once", action="store_true", help="Drain due jobs and exit")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)
    settings = Settings()
    db.configure(settings.database_url)
    db.init_db()

    if args.once:
        print(f"processed {drain(settings)} job(s)")
        return

    while True:
        if not run_once(settings):
            time.sleep(settings.worker_poll_interval)


if __name__ == "__main__":
    main()

