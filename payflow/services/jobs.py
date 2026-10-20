from __future__ import annotations

import random
from datetime import datetime, timedelta

from sqlalchemy import select, update

from ..ids import new_id
from ..models import Job
from ..timeutil import utcnow


def enqueue(
    session,
    *,
    kind: str,
    payload: dict,
    aggregate_id: str | None = None,
    run_at: datetime | None = None,
    max_attempts: int = 5,
) -> Job:
    job = Job(
        id=new_id("job"),
        kind=kind,
        aggregate_id=aggregate_id,
        payload=payload,
        status="pending",
        attempts=0,
        max_attempts=max_attempts,
        next_run_at=run_at or utcnow(),
    )
    session.add(job)
    session.flush()
    return job


def retry_delay_seconds(attempts: int, *, base: float = 1.0, cap: float = 60.0) -> float:
    """Exponential backoff with jitter, bounded by the cap."""
    raw = min(cap, base * (2 ** max(attempts - 1, 0)))
    return raw + random.uniform(0, min(0.5, raw / 2))


def claim_next(session, *, worker_id: str, lease_seconds: int = 60) -> Job | None:
    """Claim one due job with a conditional update, so two workers cannot both win."""
    now = utcnow()
    candidate = session.scalar(
        select(Job)
        .where(Job.status.in_(("pending", "retrying")), Job.next_run_at <= now)
        .order_by(Job.created_at, Job.id)
        .limit(1)
    )
    if candidate is None:
        return None

    current = ("pending",) if candidate.status == "pending" else ("retrying",)

    result = session.execute(
        update(Job)
        .where(Job.id == candidate.id, Job.status.in_(current))
        .values(
            status="running",
            claimed_by=worker_id,
            lease_expires_at=now + timedelta(seconds=lease_seconds),
            updated_at=now,
        )
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        return None

    session.refresh(candidate)
    return candidate


def recover_expired(session) -> int:
    """Return abandoned jobs to the queue after a worker crash."""
    now = utcnow()
    result = session.execute(
        update(Job)
        .where(Job.status == "running", Job.lease_expires_at < now)
        .values(status="retrying", claimed_by=None, lease_expires_at=None, updated_at=now)
        .execution_options(synchronize_session=False)
    )
    return int(result.rowcount or 0)


def mark_succeeded(session, job_id: str) -> None:
    job = session.get(Job, job_id)
    if job is None:
        return
    job.status = "succeeded"
    job.claimed_by = None
    job.lease_expires_at = None
    job.last_error = None


def mark_failed(session, job_id: str, error: str, *, retryable: bool) -> None:
    job = session.get(Job, job_id)
    if job is None:
        return
    job.attempts += 1
    job.last_error = error[:2000]
    job.claimed_by = None
    job.lease_expires_at = None
    if retryable and job.attempts < job.max_attempts:
        job.status = "retrying"
        job.next_run_at = utcnow() + timedelta(
            seconds=retry_delay_seconds(job.attempts)
        )
    else:
        job.status = "dead"
        job.next_run_at = utcnow()


def cancel_for_aggregate(session, aggregate_id: str) -> None:
    session.execute(
        update(Job)
        .where(
            Job.aggregate_id == aggregate_id,
            Job.status.in_(("pending", "retrying")),
        )
        .values(status="canceled", updated_at=utcnow())
        .execution_options(synchronize_session=False)
    )
