# Implementation status

> Snapshot: 2026-10-20. The long-term plan is in [`plan.md`](./plan.md); findings
> that shaped it are in [`audit.md`](./audit.md).

## Built

| Plan item | Status | Notes |
|---|---|---|
| M0 — environment & guardrails | Partial | `uv` toolchain, typed settings, startup guards, `.env.example`, Makefile. No Docker/CI yet. |
| M1 — skeleton, auth, payments | Done | API-key hashing, merchant scoping, 202 create, get, list, cursor pagination, error envelope, request IDs, health checks. |
| M2 — state machine, simulator, idempotency, worker | Done | Four deterministic scenarios, leases, retries with jitter, dead letter, timeout → `unknown` → reconcile, cancel guard. |
| M3 — ledger | Done | Two accounts, balanced journals, unique source reference, DB-level immutability, account reads. |
| M4 — refunds | Done | Atomic capacity reservation, partial/full refunds, compensating journals, failed-refund release, idempotent creation. |
| M5 — outbox & webhooks | Not started | Queued as the next milestone. |
| M6 — security, observability, CI | Not started | Rate limits, metrics, structured logs, CI pipeline. |

## Deliberate deviations from the plan

| Deviation | Reason |
|---|---|
| **SQLite instead of PostgreSQL** | No database runtime or root access on the machine. Patterns used (unique constraints, conditional updates, leases) port directly; no `SELECT FOR UPDATE SKIP LOCKED` yet. |
| **`create_all` instead of Alembic** | Keeps the slice runnable with zero infrastructure. Migrations are the first task when Postgres lands. |
| **Single `jobs` table, no `outbox_events`** | Nothing publishes events yet, so an event log would be unused. M5 introduces `outbox_events` for fanout. |
| **No admin API** | Merchants and keys are created by `python -m payflow.seed`, matching the plan's M1 scope. |

## Verification

```bash
uv run pytest        # 38 passed
uv run ruff check .  # clean
```

Covered: auth and tenant isolation, 202 contract, validation, pagination,
idempotent replay and conflict, 5-way concurrent duplicate creation, approve /
decline / timeout / transient flows, worker retry and replay safety, reconciliation,
refund capacity under two concurrent requests, failed-refund release, and
ledger immutability.
