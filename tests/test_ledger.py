from __future__ import annotations

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from payflow import db
from payflow.models import LedgerEntry, LedgerTransaction
from payflow.services import ledger


def test_unbalanced_journal_is_rejected(app, merchant):
    with db.session_scope() as session:
        accounts = ledger.ensure_accounts(session, merchant["id"])
        with pytest.raises(ledger.LedgerInvariantError):
            ledger.post_journal(
                session,
                source_type="test",
                source_id="unbalanced",
                currency="INR",
                entries=[
                    (accounts["processor_clearing"], "debit", 100),
                    (accounts["merchant_payable"], "credit", 90),
                ],
            )


def test_journal_requires_at_least_two_entries(app, merchant):
    with db.session_scope() as session:
        accounts = ledger.ensure_accounts(session, merchant["id"])
        with pytest.raises(ledger.LedgerInvariantError):
            ledger.post_journal(
                session,
                source_type="test",
                source_id="single",
                currency="INR",
                entries=[(accounts["processor_clearing"], "debit", 100)],
            )


def test_same_source_posts_once(app, merchant):
    with db.session_scope() as session:
        accounts = ledger.ensure_accounts(session, merchant["id"])
        first = ledger.post_journal(
            session,
            source_type="test",
            source_id="business-event-1",
            currency="INR",
            entries=[
                (accounts["processor_clearing"], "debit", 500),
                (accounts["merchant_payable"], "credit", 500),
            ],
        )
        session.commit()
        second = ledger.post_journal(
            session,
            source_type="test",
            source_id="business-event-1",
            currency="INR",
            entries=[
                (accounts["processor_clearing"], "debit", 500),
                (accounts["merchant_payable"], "credit", 500),
            ],
        )
        session.commit()
        assert first.id == second.id

    with db.session_scope() as session:
        count = session.scalar(select(func.count()).select_from(LedgerTransaction))
    assert count == 1


def test_posted_entries_cannot_be_updated(client, merchant, create_payment, process):
    create_payment().json()
    process()

    with db.session_scope() as session:
        entry = session.scalar(select(LedgerEntry))
        entry.amount_minor = 1
        with pytest.raises(IntegrityError):
            session.commit()


def test_posted_entries_cannot_be_deleted(client, merchant, create_payment, process):
    create_payment().json()
    process()

    with db.session_scope() as session:
        entry = session.scalar(select(LedgerEntry))
        session.delete(entry)
        with pytest.raises(IntegrityError):
            session.commit()
