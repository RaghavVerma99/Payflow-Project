from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from ..ids import new_id
from ..models import Account, LedgerEntry, LedgerTransaction
from ..timeutil import utcnow

ACCOUNT_SPECS = (
    ("processor_clearing", "Processor clearing", "asset"),
    ("merchant_payable", "Merchant payable", "liability"),
)


class LedgerInvariantError(Exception):
    pass


def ensure_accounts(session, merchant_id: str) -> dict[str, Account]:
    existing = {
        account.code: account
        for account in session.scalars(
            select(Account).where(Account.merchant_id == merchant_id)
        )
    }
    missing = [spec for spec in ACCOUNT_SPECS if spec[0] not in existing]
    if missing:
        try:
            with session.begin_nested():
                for code, name, kind in missing:
                    session.add(
                        Account(
                            id=new_id("acct"),
                            merchant_id=merchant_id,
                            code=code,
                            name=name,
                            kind=kind,
                            currency="INR",
                        )
                    )
                session.flush()
        except IntegrityError:
            # A concurrent request created them first; re-read below.
            pass
        existing = {
            account.code: account
            for account in session.scalars(
                select(Account).where(Account.merchant_id == merchant_id)
            )
        }
    return existing


def post_journal(
    session,
    *,
    source_type: str,
    source_id: str,
    currency: str,
    entries: list[tuple[Account, str, int]],
) -> LedgerTransaction:
    """Post one balanced journal per business event.

    Idempotent by (source_type, source_id): a retried worker returns the
    existing journal instead of posting a second one.
    """
    _validate_entries(currency, entries)

    existing = session.scalar(
        select(LedgerTransaction).where(
            LedgerTransaction.source_type == source_type,
            LedgerTransaction.source_id == source_id,
        )
    )
    if existing is not None:
        return existing

    transaction = LedgerTransaction(
        id=new_id("jrnl"),
        source_type=source_type,
        source_id=source_id,
        status="posted",
        currency=currency,
        posted_at=utcnow(),
    )

    try:
        with session.begin_nested():
            session.add(transaction)
            session.flush()
            for account, direction, amount_minor in entries:
                session.add(
                    LedgerEntry(
                        id=new_id("ent"),
                        transaction_id=transaction.id,
                        account_id=account.id,
                        direction=direction,
                        amount_minor=amount_minor,
                        currency=currency,
                    )
                )
            session.flush()
    except IntegrityError:
        # Lost the race on the unique source reference: reuse the winner's journal.
        existing = session.scalar(
            select(LedgerTransaction).where(
                LedgerTransaction.source_type == source_type,
                LedgerTransaction.source_id == source_id,
            )
        )
        if existing is None:
            raise
        return existing

    return transaction


def _validate_entries(currency: str, entries: list[tuple[Account, str, int]]) -> None:
    if len(entries) < 2:
        raise LedgerInvariantError("A journal needs at least two entries.")

    debits = 0
    credits = 0
    for account, direction, amount_minor in entries:
        if direction not in ("debit", "credit"):
            raise LedgerInvariantError(f"Invalid entry direction: {direction}")
        if not isinstance(amount_minor, int) or amount_minor <= 0:
            raise LedgerInvariantError("Entry amounts must be positive integers.")
        if account.currency != currency:
            raise LedgerInvariantError("Journal and account currencies must match.")
        if direction == "debit":
            debits += amount_minor
        else:
            credits += amount_minor

    if debits != credits:
        raise LedgerInvariantError(f"Unbalanced journal: debits={debits} credits={credits}")


def account_balance(session, account: Account) -> int:
    rows = session.execute(
        select(LedgerEntry.direction, func.sum(LedgerEntry.amount_minor))
        .where(LedgerEntry.account_id == account.id)
        .group_by(LedgerEntry.direction)
    ).all()
    totals = {direction: int(total) for direction, total in rows}
    if account.kind == "asset":
        return totals.get("debit", 0) - totals.get("credit", 0)
    return totals.get("credit", 0) - totals.get("debit", 0)


def entries_for(session, transaction_id: str) -> list[LedgerEntry]:
    return list(
        session.scalars(
            select(LedgerEntry)
            .where(LedgerEntry.transaction_id == transaction_id)
            .order_by(LedgerEntry.created_at, LedgerEntry.id)
        )
    )


def journals_for_account(session, account_id: str, *, limit: int) -> list[LedgerTransaction]:
    subquery = select(LedgerEntry.transaction_id).where(LedgerEntry.account_id == account_id)
    return list(
        session.scalars(
            select(LedgerTransaction)
            .where(LedgerTransaction.id.in_(subquery))
            .order_by(LedgerTransaction.created_at.desc(), LedgerTransaction.id.desc())
            .limit(limit)
        )
    )


def journal_for_source(session, source_type: str, source_id: str) -> LedgerTransaction | None:
    return session.scalar(
        select(LedgerTransaction).where(
            LedgerTransaction.source_type == source_type,
            LedgerTransaction.source_id == source_id,
        )
    )
