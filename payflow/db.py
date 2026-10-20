"""Database engine and session management.

A single global engine is configured at application startup. Tests point it at
a temporary SQLite file. The same code runs on PostgreSQL by changing
PAYFLOW_DATABASE_URL; see README for the dialect differences.
"""

from __future__ import annotations

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None


def configure(database_url: str, *, echo: bool = False) -> None:
    global _engine, _session_factory

    if _engine is not None:
        _engine.dispose()

    kwargs: dict = {"echo": echo, "pool_pre_ping": True}
    is_sqlite = database_url.startswith("sqlite")
    if is_sqlite:
        # FastAPI runs sync endpoints in a thread pool, so connections cross threads.
        kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}

    _engine = create_engine(database_url, **kwargs)

    if is_sqlite:

        @event.listens_for(_engine, "connect")
        def _sqlite_pragmas(dbapi_connection, _record) -> None:  # noqa: ANN001
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA busy_timeout=30000")
            cursor.close()

    _session_factory = sessionmaker(bind=_engine, expire_on_commit=False, autoflush=False)


def engine() -> Engine:
    if _engine is None:
        raise RuntimeError("database is not configured")
    return _engine


def session_scope() -> Session:
    if _session_factory is None:
        raise RuntimeError("database is not configured")
    return _session_factory()


def init_db() -> None:
    from . import models

    models.Base.metadata.create_all(engine())
    _install_sqlite_guards()


def _install_sqlite_guards() -> None:
    """Enforce ledger immutability at the database level, not just in services."""
    statements = [
        """
        CREATE TRIGGER IF NOT EXISTS trg_ledger_entries_no_update
        BEFORE UPDATE ON ledger_entries
        BEGIN
            SELECT RAISE(ABORT, 'ledger entries are immutable');
        END
        """,
        """
        CREATE TRIGGER IF NOT EXISTS trg_ledger_entries_no_delete
        BEFORE DELETE ON ledger_entries
        BEGIN
            SELECT RAISE(ABORT, 'ledger entries are immutable');
        END
        """,
        """
        CREATE TRIGGER IF NOT EXISTS trg_ledger_tx_posted_no_delete
        BEFORE DELETE ON ledger_transactions
        WHEN OLD.status = 'posted'
        BEGIN
            SELECT RAISE(ABORT, 'posted journals are immutable');
        END
        """,
    ]
    with engine().begin() as connection:
        for statement in statements:
            connection.exec_driver_sql(statement)


def run_with_retry(session: Session, work, *, attempts: int = 5):
    """Commit a unit of work, retrying brief SQLite write contention.

    PostgreSQL would serialize on the unique constraint instead; the retry is
    harmless there because a failed transaction leaves no partial writes.
    """
    import time

    from sqlalchemy.exc import OperationalError

    for attempt in range(attempts):
        try:
            result = work()
            session.commit()
            return result
        except OperationalError as exc:
            session.rollback()
            if "locked" in str(exc).lower() and attempt < attempts - 1:
                time.sleep(0.05 * (attempt + 1))
                continue
            raise
        except Exception:
            session.rollback()
            raise

