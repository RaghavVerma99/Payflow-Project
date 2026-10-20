# PayFlow

A small, working **payment processing simulator** — an authenticated REST API with
idempotent payment creation, a deterministic processor, a durable job worker,
double-entry ledger postings, and refunds that cannot exceed the original payment.

> **Simulation only.** No real card data is accepted or stored, no processor is
> contacted, and no money moves. Amounts are integer minor units (paise).

This is the M0–M4 vertical slice from [`docs/plan.md`](./docs/plan.md): correctness
first, with webhooks, metrics, and rate limiting deliberately left out.

---

## What works

| Capability | Status |
|---|---|
| API-key auth, hashed at rest, merchant-scoped reads | Yes |
| `POST /v1/payments` → `202`, idempotent by `Idempotency-Key` | Yes |
| Explicit state machine (`created → processing → succeeded/failed/unknown`) | Yes |
| Deterministic simulator: approve, decline, timeout, transient failure | Yes |
| Durable jobs with leases, retries, backoff, dead-lettering | Yes |
| Timeout resolves to `unknown`, reconciled by `lookup()` — never assumed declined | Yes |
| Double-entry ledger, one journal per business event, balances checked | Yes |
| Posted ledger entries immutable at the database level | Yes |
| Partial and full refunds bounded under concurrency | Yes |
| Cursor pagination, uniform error envelope, request IDs | Yes |
| Webhooks, outbox fanout, metrics, rate limiting, Postgres | **Not yet** (see *Limitations*) |

38 tests cover the API, state machine, idempotency races, refund capacity races,
worker retries, reconciliation, and ledger immutability.

---

## Quick start

Requires [uv](https://docs.astral.sh/uv/) (no root, no Docker, no Postgres).

```bash
uv sync
uv run python -m payflow.seed          # prints two test API keys once
uv run uvicorn payflow.main:create_app --factory --reload
```

The API starts on `http://localhost:8000`, docs at `/docs`. The background worker
starts with the app; set `PAYFLOW_WORKER_ENABLED=false` to run it separately:

```bash
uv run python -m payflow.worker        # continuous
uv run python -m payflow.worker --once # drain due jobs and exit
```

State lives in `./payflow.db` (SQLite, WAL). Delete that file to start over.

### Demo

```bash
KEY="sk_test_..."   # from the seed output

# Create — returns 202 with status "created"
curl -s -X POST localhost:8000/v1/payments \
  -H "Authorization: Bearer $KEY" \
  -H "Idempotency-Key: order_784_payment_1" \
  -H "Content-Type: application/json" \
  -d '{"amount":49900,"customer_id":"cus_demo_101","description":"Order #784"}'

# The worker settles it; retrieve the live state
curl -s localhost:8000/v1/payments/pay_... -H "Authorization: Bearer $KEY"

# Retry the same key and body — replayed, not duplicated
curl -i -X POST localhost:8000/v1/payments \
  -H "Authorization: Bearer $KEY" \
  -H "Idempotency-Key: order_784_payment_1" \
  -H "Content-Type: application/json" \
  -d '{"amount":49900,"customer_id":"cus_demo_101","description":"Order #784"}'

# Refund part of it
curl -s -X POST localhost:8000/v1/payments/pay_.../refunds \
  -H "Authorization: Bearer $KEY" \
  -H "Idempotency-Key: refund_784_1" \
  -H "Content-Type: application/json" \
  -d '{"amount":12000,"reason":"customer_request"}'

# Balances, derived from journal entries
curl -s localhost:8000/v1/accounts -H "Authorization: Bearer $KEY"
```

Force outcomes with `X-Simulator-Scenario: approve | decline | timeout | transient`
(development only; disabled when `PAYFLOW_ALLOW_SIMULATOR_CONTROLS=false`).

---

## API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/payments` | Create a payment (`Idempotency-Key` required) |
| `GET` | `/v1/payments/{id}` | Retrieve a payment |
| `GET` | `/v1/payments` | List/filter with cursor pagination |
| `POST` | `/v1/payments/{id}/cancel` | Cancel before any attempt starts |
| `GET` | `/v1/payments/{id}/events` | State transition history |
| `POST` | `/v1/payments/{id}/refunds` | Create a refund (`Idempotency-Key` required) |
| `GET` | `/v1/payments/{id}/refunds` | Refunds for one payment |
| `GET` | `/v1/refunds/{id}` | Retrieve a refund |
| `GET` | `/v1/refunds` | List refunds (optional `payment_id` filter) |
| `GET` | `/v1/accounts` | Merchant accounts with balances |
| `GET` | `/v1/accounts/{id}` | One account |
| `GET` | `/v1/accounts/{id}/transactions` | Journals touching an account |
| `GET` | `/health/live`, `/health/ready` | Liveness, dependency readiness |

Errors always use one envelope:

```json
{
  "error": {
    "code": "idempotency_conflict",
    "message": "This idempotency key was previously used with a different request.",
    "request_id": "req_..."
  }
}
```

---

## Design notes

**Idempotency.** A unique index on `(merchant_id, operation, idempotency_key)` is
the arbiter, not an application check. The winning request writes the payment and
its job in one transaction; a duplicate replays the stored `202` body with
`Idempotent-Replayed: true`. Reusing a key with a different payload is `409`;
a duplicate while the first is still in flight is `409 idempotency_in_progress`
with `Retry-After`. `GET` is always live.

**Timeouts are not declines.** A simulated timeout moves the payment to `unknown`
and enqueues a reconciliation job. Only `lookup()` can resolve it. This is the
failure mode that separates a toy from a payment system.

**Durability.** `jobs` rows are written in the same transaction as the business
change. Workers claim with a conditional `UPDATE`, hold a lease, and recover
expired leases after a crash. Handlers are idempotent: a journal is unique per
`(source_type, source_id)`, and a replayed job sees a terminal payment and stops.

**Money.** Integer minor units only. A successful payment debits
`processor_clearing` and credits `merchant_payable`. A refund posts a new
compensating journal — the original is never edited. SQLite triggers reject
`UPDATE`/`DELETE` on posted entries, so "immutable" is enforced, not asserted.

**Refund capacity.** One atomic conditional `UPDATE` reserves capacity:

```sql
UPDATE payments
SET refund_reserved_minor = refund_reserved_minor + :amount
WHERE id = :id
  AND status IN ('succeeded','partially_refunded')
  AND refunded_minor + refund_reserved_minor + :amount <= amount_minor
```

No read-then-write window, so two concurrent refunds cannot both spend the same
headroom. Failed refunds release the reservation.

**State machine.** Transitions live in one table in `payflow/state_machine.py`.
Anything not listed is a `409`, including `processing --timeout--> failed`.

---

## Layout

```text
payflow/
├── main.py            # app factory, middleware, error handlers
├── config.py          # typed settings + startup guards
├── db.py              # engine/session, SQLite guards, retry helper
├── models.py          # merchants, payments, attempts, jobs, idempotency, ledger, refunds
├── state_machine.py   # the only legal status graph
├── processor.py       # deterministic simulator + lookup()
├── worker.py          # claim → simulate → commit, leases, retries
├── api/               # HTTP layer only
├── services/          # business rules and persistence
└── seed.py            # synthetic merchants and test keys
tests/                 # 38 tests: api, processing, idempotency, refunds, ledger
docs/                  # audit + long-term plan
```

The HTTP layer never touches the database directly, and services never import
FastAPI. The simulator is an interface, so a real adapter can replace it without
touching payment logic.

---

## Tests

```bash
uv run pytest -q
uv run pytest -q -k "concurrent or timeout or immutable"
uv run ruff check .
```

Isolation is one SQLite file per test; concurrency tests use real threads and
separate clients, not mocks.

---

## Limitations (on purpose)

- **SQLite.** Single-writer and no `SELECT ... FOR UPDATE SKIP LOCKED`. The
  concurrency patterns used here (unique constraints, conditional updates,
  leases) port directly to PostgreSQL; see `docs/plan.md`.
- **No Alembic.** `create_all` keeps the slice runnable; migrations are the first
  step when moving to Postgres.
- **No webhooks or outbox fanout**, no metrics, no rate limiting, no admin API.
  These are M5–M6 in the plan.
- **One in-process worker by default.** `python -m payflow.worker` can run more,
  but SQLite serializes writes.
- **Simulator controls are enabled in dev.** Production mode refuses them and
  refuses the default API-key pepper at startup.

## Next steps

1. Postgres + Alembic, then load-test the refund and idempotency paths.
2. Outbox → signed webhook deliveries with retries and attempt history.
3. Metrics, structured logs, rate limits, CI with a Postgres service.
# Payflow-Project
