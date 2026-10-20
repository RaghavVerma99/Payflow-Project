from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..api.deps import Principal, get_session, require_merchant
from ..errors import NotFound
from ..models import Account
from ..pagination import clamp_limit
from ..schemas import AccountOut, EntryOut, JournalList, JournalOut
from ..services import ledger
from ..timeutil import iso

router = APIRouter(prefix="/v1/accounts", tags=["accounts"])


@router.get("", response_model=list[AccountOut])
def list_accounts(
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_merchant),
) -> list[AccountOut]:
    accounts = list(
        session.scalars(
            select(Account)
            .where(Account.merchant_id == principal.merchant_id)
            .order_by(Account.code)
        )
    )
    return [_account_out(session, account) for account in accounts]


@router.get("/{account_id}", response_model=AccountOut)
def get_account(
    account_id: str,
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_merchant),
) -> AccountOut:
    account = session.scalar(
        select(Account).where(
            Account.id == account_id, Account.merchant_id == principal.merchant_id
        )
    )
    if account is None:
        raise NotFound("Account not found.")
    return _account_out(session, account)


@router.get("/{account_id}/transactions", response_model=JournalList)
def list_account_transactions(
    account_id: str,
    limit: int | None = Query(default=None, ge=1),
    session: Session = Depends(get_session),
    principal: Principal = Depends(require_merchant),
) -> JournalList:
    account = session.scalar(
        select(Account).where(
            Account.id == account_id, Account.merchant_id == principal.merchant_id
        )
    )
    if account is None:
        raise NotFound("Account not found.")

    page_size = clamp_limit(limit, default=25, maximum=100)
    journals = ledger.journals_for_account(session, account.id, limit=page_size + 1)
    has_more = len(journals) > page_size
    journals = journals[:page_size]

    return JournalList(
        data=[
            JournalOut(
                id=journal.id,
                source_type=journal.source_type,
                source_id=journal.source_id,
                status=journal.status,
                currency=journal.currency,
                created_at=iso(journal.created_at),
                posted_at=iso(journal.posted_at),
                entries=[
                    EntryOut(
                        account_id=entry.account_id,
                        direction=entry.direction,
                        amount=entry.amount_minor,
                        currency=entry.currency,
                    )
                    for entry in ledger.entries_for(session, journal.id)
                ],
            )
            for journal in journals
        ],
        has_more=has_more,
        next_cursor=None,
    )


def _account_out(session: Session, account: Account) -> AccountOut:
    return AccountOut(
        id=account.id,
        code=account.code,
        name=account.name,
        kind=account.kind,
        currency=account.currency,
        balance=ledger.account_balance(session, account),
        created_at=iso(account.created_at),
    )
