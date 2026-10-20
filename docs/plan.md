# PayFlow — Implementation Plan

> Companion to [`audit.md`](./audit.md). Blueprint section references (§n) point at `PayFlow_Project_Blueprint.md`.
> Principle preserved from the blueprint: **correct data model → clear API contract → safe transitions → idempotency → ledger → durable work → webhooks → security → measured performance.**

---

## 1. Sequencing changes

The blueprint's six milestones are kept. Two things move in front of them:

| Change | Why |
|---|---|
| **M0 added: environment + decisions** | Nothing runs today: no Postgres, no Docker, no `pip` (audit §2) |
| **ADRs written before M2** | F2, F4, F5, F6, F7 each fix a contract or schema that is costly to change mid-build |

Everything else follows the blueprint's order. No dashboard, SDK, Redis, or microservice work enters M0–M6.

---

## 2. Architecture decisions (write these as ADRs in M0)

| ID | Decision | Recommendation | Rationale / consequence |
|---|---|---|---|
| ADR-000 | Python + DB runtime | **Python 3.13 via `uv`; PostgreSQL 18 in Docker Compose** | Every wheel path stays open; `uv` needs no root or `ensurepip`; Compose matches §4 and CI |
| ADR-001 | SQLAlchemy sync vs async | **Sync (`psycopg` 3), `Session` per request** | Row locks, `FOR UPDATE SKIP LOCKED`, and transaction boundaries stay explicit and easy to test; FastAPI async buys nothing at this scale |
| ADR-002 | Durability mechanism | **Postgres `jobs` table with lease columns; no Redis** | Matches §4; crash recovery is testable; one datastore |
| ADR-003 | Idempotency replay contract | **409 in-progress; stored 202 replayed verbatim for 24 h; GET is live** | Removes the ambiguity in §6.6; makes concurrency tests deterministic |
| ADR-004 | Ledger immutability | **Service validation + deferred balance trigger + revoked `UPDATE/DELETE` grants** | §10.3's claim becomes enforceable and testable |
| ADR-005 | Refund capacity | **Lock payment row; sum `reserved+processing+succeeded` refunds** | No second source of truth; closes the oversell race in §6.4 |
| ADR-006 | Webhook secret at rest | **Fernet-encrypted with `WEBHOOK_SECRET_ENC_KEY`; startup fails outside `ENV=dev` if unset** | §9.8 requires reconstruction for HMAC; a hash cannot sign |
| ADR-007 | Rate limiting | **In-process fixed window per key/IP in v1** | No Redis; documented as single-process-only |
| ADR-008 | Public IDs | **Prefix + 96-bit random (`pay_`, `ref_`, `evt_`, `whk_`, `dlv_`, `key_`, `mer_`, `req_`)** | Non-enumerable without a sequence; readable in logs |
| ADR-009 | Time | **`TIMESTAMPTZ`, UTC; `now()` from the DB for state changes; injected clock in unit tests** | Avoids app/DB clock skew in cursor pagination |
| ADR-010 | Validation policy | **422 for schema errors, 400 for semantic errors, stable `ErrorCode` enum** | §15 leaves this open; one policy, one registry |
| ADR-011 | Settings validation | **`pydantic-settings`; fail fast at startup on missing/insecure config** | Prevents a dev default silently reaching a public deployment |

**Amendment A1 — jobs vs outbox.** Split the work queue from the event log:

- `jobs` — durable units of work (`process_payment`, `deliver_webhook`, `reconcile_attempt`). Columns include `status`, `attempts`, `max_attempts`, `next_run_at`, `claimed_by`, `lease_expires_at`, `last_error`.
- `outbox_events` — append-only business event log + fanout marker (`published_at`), no HTTP retry state.

This resolves F4 (no lease) and F15 (two overlapping retry models) while staying inside §12's pattern.

**Amendment A2 — `202` from day one.** To avoid a mid-project contract change, M1 already returns `202 Accepted` with `status: "created"` and writes a `jobs` row in the same transaction. M1's worker is `--once` only; M2 adds the lease loop. §3.4's warning about mixing sync and async is respected: there is exactly one mode.

**Amendment A3 — API surface additions.**

| Endpoint | Reason |
|---|---|
| `GET /v1/accounts` | §8.3 starts at `{account_id}` with no way to discover it (F10) |
| `PATCH /v1/webhook-endpoints/{id}` | Enable/disable without delete-and-recreate |
| `POST /v1/api-keys`, `DELETE /v1/api-keys/{id}` | Rotate/revoke without shelling in; operator-scoped |
| `GET /metrics` (internal port) | §17.2 metrics need an endpoint (F13) |

Admin-only routes are gated by a separate `pf_admin_` key kind or a CLI; neither is exposed without auth.

---

## 3. Target repository layout

Tags: **M0** bootstrap · **M1** skeleton/auth/payments · **M2** idempotency/worker · **M3** ledger · **M4** refunds · **M5** webhooks · **M6** hardening.
Only create a file when its milestone begins — the tree is a target, not a day-one checklist.

```text
payflow/
├── .github/workflows/ci.yml        # M0 lint+unit; M3 adds integration; M4 concurrency service
├── app/
│   ├── main.py                     # M1 app factory, middleware, routers, handlers
│   ├── config.py                   # M1 typed Settings + startup validation
│   ├── api/
│   │   ├── dependencies.py         # M1 session, Principal, request context, pagination
│   │   ├── error_handlers.py       # M1 domain → HTTP, single error envelope
│   │   └── v1/
│   │       ├── router.py           # M1 composition
│   │       ├── payments.py         # M1 create/get/list · M2 confirm/cancel/events
│   │       ├── refunds.py          # M4
│   │       ├── accounts.py         # M3 (incl. GET list — A3)
│   │       ├── webhooks.py         # M5
│   │       ├── api_keys.py         # M6 (A3)
│   │       └── health.py           # M0 live · M1 ready
│   ├── core/
│   │   ├── security.py             # M1 key gen/hash/verify · M5 HMAC sign/verify
│   │   ├── exceptions.py           # M1 DomainError hierarchy
│   │   ├── errors.py               # M1 ErrorCode enum + status/message registry (ADR-010)
│   │   ├── logging.py              # M1 JSON logs + redaction
│   │   ├── request_context.py      # M1 request_id, correlation
│   │   ├── pagination.py           # M1 opaque (created_at, id) cursor (F18)
│   │   ├── clock.py                # M1 injectable utcnow()
│   │   └── ids.py                  # M1 prefixed random IDs (ADR-008)
│   ├── db/
│   │   ├── base.py                 # M1 DeclarativeBase, naming convention, enum types
│   │   ├── session.py              # M1 engine + session factory
│   │   ├── transaction.py          # M1 transaction boundary helper
│   │   └── types.py                # M1 MoneyMinor (BIGINT) + currency checks (F9)
│   ├── merchants/                  # M1 models/schemas/repository/service
│   ├── payments/                   # M1 models/schemas/repository/service
│   │   └── state_machine.py        # M2 transitions + attempt status enum (F7)
│   ├── refunds/                    # M4 models/schemas/repository/service/state_machine
│   ├── ledger/                     # M3 models/schemas/repository/service/invariants
│   ├── processors/
│   │   ├── base.py                 # M2 Protocol: authorize_or_process() + lookup() (F8)
│   │   ├── simulator.py            # M2 deterministic scenarios, queryable by reference
│   │   └── errors.py               # M2 transient/decline/timeout taxonomy
│   ├── idempotency/                # M2 models/repository/service (claim, replay, conflict)
│   ├── jobs/                       # M1 models · M2 lease repository/service (A1)
│   ├── outbox/                     # M5 event append + fanout (A1)
│   ├── webhooks/                   # M5 models/schemas/repository/service
│   │   ├── dispatcher.py           # M5 timeouts, backoff+jitter, dead letter
│   │   ├── signing.py              # M5 HMAC envelope + verification helper
│   │   └── destination_policy.py   # M5 SSRF/DNS/allowlist rules
│   ├── workers/
│   │   ├── loop.py                 # M2 claim/dispatch/lease renewal
│   │   ├── payment_worker.py       # M2
│   │   ├── webhook_worker.py       # M5
│   │   ├── reconciliation_worker.py# M2 unknown outcomes · M6 audit/report
│   │   └── __main__.py             # M2 python -m app.workers [--once]
│   └── observability/
│       ├── metrics.py              # M6 registry + label allowlist
│       └── middleware.py           # M6 latency/status metrics
├── migrations/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/                   # one revision per milestone, never edited after merge
├── tests/
│   ├── conftest.py                 # M1 engine, truncate isolation, factories, 3 tenants
│   ├── factories.py
│   ├── unit/                       # state machine, invariants, signing, backoff, cursor
│   ├── api/                        # contracts, auth, isolation, pagination, errors
│   ├── integration/                # real PG: atomicity, ledger, worker recovery
│   ├── concurrency/                # real PG, separate connections, no xdist
│   └── failure/                    # timeout, crash-after-effect, webhook 500, duplicate
├── scripts/
│   ├── seed_demo_data.py           # M1 synthetic merchants + test keys
│   ├── simulate_webhook_receiver.py# M5 configurable 200/500/delay/refuse
│   ├── reconciler.py               # M6 inspect/requeue dead letters (CLI)
│   └── demo.sh                     # M6 end-to-end walkthrough
├── docs/
│   ├── architecture.md
│   ├── api-examples.md             # curl per scenario (§22.3)
│   ├── errors.md                   # M1 code registry (F14)
│   ├── data-model.md               # M2 enums + constraints (F16)
│   ├── operations.md               # M6 retention, runbooks, metrics (F23)
│   ├── openapi.json                # CI-generated + snapshot-tested
│   └── decisions/                  # ADR-000 … ADR-011 + template
├── compose.yaml                    # M0 postgres; M2 adds api/worker; M6 adds full stack
├── Dockerfile
├── alembic.ini
├── pyproject.toml
├── uv.lock
├── Makefile
├── .env.example
├── .gitignore
├── .editorconfig
├── .pre-commit-config.yaml
├── LICENSE
└── README.md
```

**Deleted from the blueprint's layout:** `app/core/idempotency.py` (F3 — superseded by `app/idempotency/`), `app/db/transaction.py` kept but scoped to one helper, and `docker-compose.yml` renamed `compose.yaml`.
**Renamed:** `app/outbox/` is no longer the job queue; `app/jobs/` is (A1).

---

## 4. Milestones

Estimates assume the blueprint's 2–4 h "session" and are advisory.

### M0 — Environment, guardrails, decisions (1 session)

**Objective:** a clean clone can install, start a database, serve `/health/live`, and run an empty-but-green test suite.

- [ ] `git init`, `.gitignore`, `LICENSE`, initial commit of blueprint + docs
- [ ] Install `uv`; `uv python pin 3.13`; create `pyproject.toml` with runtime/dev dependency groups
- [ ] Resolve the DB runtime: Docker (recommended) or supported fallback — **needs user input, see §8**
- [ ] `compose.yaml` with `postgres:18`, healthcheck, named volume, non-default port
- [ ] `app/main.py` + `/health/live`; `app/config.py` with `pydantic-settings`
- [ ] `Makefile`: `install up down migrate revision test test-int lint fmt typecheck openapi seed`
- [ ] `.env.example` (placeholders only), `.editorconfig`, `.pre-commit-config.yaml` (ruff, ruff-format, mypy)
- [ ] CI: lint + typecheck + unit on push; Postgres service ready but unused until M3
- [ ] ADR-000…011 + `docs/decisions/000-template.md`
- [ ] `docs/errors.md` skeleton (code, HTTP status, meaning), `docs/data-model.md` skeleton
- [ ] `tests/conftest.py` skeleton with a real-Postgres fixture plan

**Exit:** `make bootstrap && make up && make migrate && make test` succeeds on a fresh clone; `curl localhost:8000/health/live` → `200`; CI green.

---

### M1 — Walking skeleton: auth, payments create/get/list (2 sessions)

**Objective:** one verified end-to-end request path in the final response shape.

- [ ] `db/session.py`, `db/base.py` (naming convention for constraints), first Alembic revision
- [ ] Tables: `merchants`, `api_keys`, `payments`, `jobs` (minimal), plus indexes from §9.9
- [ ] `merchants` service: generate `sk_test_…`, store SHA-256 of the secret + `key_prefix`, verify in constant time
- [ ] `seed_demo_data.py`: two merchants, keys printed once
- [ ] Auth dependency → `Principal(merchant_id, key_id, permissions)`; `401` on missing/invalid/revoked
- [ ] Request-ID middleware; error envelope + `ErrorCode` registry; 422 vs 400 policy
- [ ] `POST /v1/payments` → **202**, `status: "created"`, payment + `jobs` row in one transaction
- [ ] `GET /v1/payments/{id}` and `GET /v1/payments` with opaque cursor, `status`/date filters, max limit
- [ ] `/health/ready` checks DB with a short timeout
- [ ] Tests: valid create; zero/negative amount; missing fields; unknown payment; merchant isolation; list pagination; error shape

**Exit tests:**
```bash
uv run pytest tests/api -q
# test_create_returns_202_and_persists_job
# test_other_merchant_cannot_read_payment
# test_zero_amount_is_rejected_with_stable_code
# test_cursor_pagination_is_stable_under_ties
```
**Non-goals:** no processor, no idempotency enforcement (header accepted but documented as not yet enforced), no ledger.

---

### M2 — State machine, simulator, idempotency, worker (3 sessions)

**Objective:** retries are safe and asynchronous processing survives a crash.

- [ ] `payment_attempts` table + attempt status enum; transition table as executable code
- [ ] Enforce transitions with conditional `UPDATE ... WHERE status = :expected` (no lost updates)
- [ ] Processor `Protocol` with `authorize_or_process()` **and** `lookup(reference)` (F8)
- [ ] Simulator: approve, decline(code), timeout, delay, transient-then-success; scenario controlled only when `ALLOW_SIMULATOR_CONTROLS=true`; never client-controlled in public mode
- [ ] `idempotency_records` table + unique constraint; canonical hash; claim/replay/conflict/in-progress (ADR-003)
- [ ] `jobs` lease columns + partial index `(status, next_run_at) WHERE status IN ('pending','retrying')`
- [ ] Worker loop: `FOR UPDATE SKIP LOCKED`, `claimed_by`, `lease_expires_at`, exponential backoff + jitter, `max_attempts`, dead letter
- [ ] Unknown handling: timeout → attempt `timed_out`, payment `unknown`; reconciler calls `lookup()`; never a blind second charge
- [ ] `confirm` and `cancel` with guard `status='created' AND no attempt row` (F17)
- [ ] Tests: 10 concurrent identical requests → 1 payment; conflicting body → 409; decline → `failed`, no journal; timeout → `unknown`; worker restart recovers expired lease

**Exit tests:**
```bash
uv run pytest tests/concurrency/test_idempotency.py -q
uv run pytest tests/failure/test_worker_recovery.py -q
```
**Non-goals:** no ledger postings yet; success/failure only update payment state.

---

### M3 — Ledger correctness (2 sessions)

**Objective:** money movement is recorded once, balances, and cannot be mutated.

- [ ] `accounts`, `ledger_transactions`, `ledger_entries` with: journal-level `currency`/`reversal_of_id`, `posted_at`, `CHECK amount > 0`, `CHECK direction IN ('debit','credit')`
- [ ] `UNIQUE (source_type, source_id)` on journals — the duplicate-post guard
- [ ] Deferred constraint trigger asserting debits = credits per journal/currency
- [ ] `post_journal()` in the same transaction as the payment state change; validate before insert
- [ ] `payflow_app` DB role; `REVOKE UPDATE, DELETE` on `ledger_entries`; test that it fails
- [ ] Seed platform accounts (`processor_clearing`, `merchant_payable`) per merchant
- [ ] `GET /v1/accounts`, `GET /v1/accounts/{id}`, `GET /v1/accounts/{id}/transactions` (cursor)
- [ ] Tests: success posts exactly one balanced journal; decline posts none; repeat handler posts none; update/delete rejected; reversal creates a new linked journal

**Exit tests:**
```bash
uv run pytest tests/integration/test_ledger.py -q
# test_duplicate_handler_posts_single_journal
# test_imbalanced_journal_is_rejected
# test_posted_entry_is_immutable
```

---

### M4 — Refunds and concurrency (2–3 sessions)

**Objective:** partial/full refunds are bounded, idempotent, and auditable.

- [ ] `refunds` table with `status IN ('reserved','processing','succeeded','failed','canceled')`
- [ ] Create refund: `SELECT payment FOR UPDATE` → sum active refunds → reject if `sum + amount > payment.amount`
- [ ] Idempotency scope `POST:/v1/payments/{id}/refunds`
- [ ] Refund worker → processor simulation → compensating journal (never edit the original)
- [ ] Derive payment status: `partially_refunded` / `refunded` only inside the refund completion transaction
- [ ] Endpoints: create, get, list-per-payment, `GET /v1/refunds` (merchant-scoped)
- [ ] Tests: two concurrent ₹400 refunds on ₹499 → one succeeds; 10 duplicate requests → 1 refund; partial then full → derived states; ledger reversal links original

**Exit tests:**
```bash
uv run pytest tests/concurrency/test_refunds.py -q
uv run pytest tests/integration/test_refund_ledger.py -q
```

---

### M5 — Outbox, jobs fanout, webhooks (3 sessions)

**Objective:** committed events are delivered at least once, signed, retried, and inspectable.

- [ ] `outbox_events` (append-only) written in the same transaction as payment/refund changes
- [ ] Fanout handler: one `webhook_deliveries` row per (event, endpoint); outbox marks `published_at`, no HTTP in it
- [ ] HMAC-SHA256 over `{timestamp}.{raw_body}`; `PayFlow-Signature: t=…,v1=…`; constant-time compare; 5-minute tolerance
- [ ] Fernet secret storage (ADR-006); secret returned once; startup guard outside `ENV=dev`
- [ ] Dispatcher: 3 s connect / 5 s read, 64 KB response cap, 5xx/timeout retry, 4xx permanent, backoff + jitter, dead letter
- [ ] SSRF policy: block loopback/link-local/private/metadata, resolve-then-connect check, env allowlist for local demo
- [ ] Endpoints: register/list/patch/delete endpoints; inspect delivery + attempts; authorized manual retry
- [ ] `simulate_webhook_receiver.py` with switchable 200/500/delay/refuse
- [ ] Tests: event survives kill/restart; 500 → backoff schedule; duplicate delivery reuses event id; bad signature/stale timestamp rejected; private URL blocked

**Exit tests:**
```bash
uv run pytest tests/failure/test_webhooks.py -q
uv run pytest tests/unit/test_signing.py -q
```

---

### M6 — Security, observability, operations, docs (2 sessions)

**Objective:** the 16 acceptance criteria in §19 are demonstrably met.

- [ ] Rate limits on auth, create, webhook registration, manual retry (ADR-007)
- [ ] Body-size cap, string lengths, date-range width, strict CORS, security headers, no body logging by default
- [ ] API-key rotation/revoke endpoints + `pf_admin_` scope (A3)
- [ ] Structured logs with `request_id`/`merchant_id`/`payment_id`/`attempt_id`/`event_id`; redaction test
- [ ] `prometheus-client` metrics on an internal port; label allowlist; no payment IDs as labels
- [ ] Readiness checks with timeouts; liveness never touches the DB
- [ ] CI: integration + concurrency jobs against a Postgres service; coverage gate (~85% on `app/` excluding migrations)
- [ ] `Dockerfile` (non-root), full-stack `compose.yaml`, `make demo`
- [ ] `README.md` with all 14 sections from §20.2, simulation disclaimer first
- [ ] `docs/operations.md`: retention (idempotency 24 h, deliveries 30 d, dead letters manual), runbooks, metrics
- [ ] OpenAPI snapshot test so the documented contract cannot drift
- [ ] Reconcile CLI: list dead letters, unresolved attempts, ledger/source mismatches; safe requeue only

**Exit:** all acceptance rows in §6 pass; `make demo` runs the §22.3 scenarios end to end.

---

### M7 — Optional, only after M0–M6 (not planned)

Merchant dashboard, Python SDK, load-test harness, broker adapter. Blueprint §20.3 already cautions against stack inflation; keep this out of scope until the acceptance matrix is green.

---

## 5. Cross-cutting standards

- **Transactions:** one HTTP request = one transaction, committed before any network call. Workers commit the side effect and the job-state update together where possible, and are idempotent where not.
- **Tenant scoping:** repositories require `merchant_id` as a positional argument; there is no `get_by_id(id)` without it.
- **Enums:** Python `StrEnum` + Postgres `CHECK` (or native enum) defined in one place and asserted equal by a test.
- **Money:** `BIGINT` minor units, `1 ≤ amount ≤ 100_000_000_000`, `currency = 'INR'`, exponent 2. No floats anywhere, including tests.
- **Errors:** every raise goes through `DomainError` → `ErrorCode`; `request_id` always present; no stack traces.
- **Logging:** never log `Authorization`, raw keys, webhook secrets, or full request bodies.
- **Migrations:** one revision per milestone, reviewed, never edited after merge; CI runs `alembic upgrade head` on an empty DB.
- **Tests:** unit tests never touch the DB; integration/concurrency tests never mock the DB; every fixed bug gets a regression test.

---

## 6. Acceptance traceability (§19 → mechanism → test)

| §19 criterion | Mechanism | Verification |
|---|---|---|
| Clean clone configurable from `.env.example` | `make bootstrap` | CI job on a fresh checkout |
| Schema managed by migrations | Alembic only, no `create_all` | `alembic upgrade head` then `alembic check` |
| Validated request/response schemas | Pydantic models per route | `tests/api/test_contracts.py` |
| API keys hashed and revocable | SHA-256 + prefix lookup, `revoked_at` | `tests/api/test_auth.py` |
| Every access merchant-scoped | `merchant_id` required in repos | `tests/api/test_isolation.py` (per route) |
| Explicit, tested transitions | `state_machine.py` + conditional UPDATE | `tests/unit/test_state_machine.py` |
| Idempotency via DB uniqueness, tested concurrently | Unique index + claim | `tests/concurrency/test_idempotency.py` |
| Timeouts treated as uncertain | `timed_out` → `unknown` + `lookup()` | `tests/failure/test_timeout.py` |
| Journals balance; posted entries immutable | Trigger + grants + service validation | `tests/integration/test_ledger.py` |
| Refunds bounded and idempotent | Payment lock + reservation sum | `tests/concurrency/test_refunds.py` |
| Outbox survives restarts | `jobs` lease + dead letter | `tests/failure/test_worker_recovery.py` |
| Webhooks signed, retried, recorded | Dispatcher + delivery attempts | `tests/failure/test_webhooks.py` |
| Unit, API, integration, concurrency, failure tests | Five directories | `uv run pytest` |
| Structured logs without secrets | Redaction allowlist | `tests/unit/test_logging.py` |
| OpenAPI + curl examples | Generated schema + snapshot | `tests/api/test_openapi_snapshot.py` |
| README states simulation limits | README §1 disclaimer | Manual review checklist |

---

## 7. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| No DB runtime resolved at M0 | Project cannot start | Decide before writing code; Compose is the only path shared with CI |
| Single missing tenant filter leaks data | Portfolio-fatal security bug | Per-route isolation tests; repo API that cannot query without `merchant_id` |
| Double ledger post from retried worker | Silent financial inconsistency | Unique `(source_type, source_id)` + handler idempotency + concurrency test |
| Refund oversell race | Broken core invariant | Row lock + reservation statuses + concurrent test, not mocks |
| `unknown` treated as decline | Duplicate charge in simulation | State machine forbids it; reconciler is the only resolver |
| SSRF via webhook URL | Internal network exposure | Deny-by-default ranges, DNS revalidation, explicit dev allowlist |
| Scope creep (dashboard/SDK) | Never reaches acceptance | M7 quarantined; acceptance matrix is the gate |
| Test suite slow/flaky from real DB | Abandoned tests | Truncate isolation, no xdist for concurrency, one Postgres service |

---

## 8. Decisions needed from you

1. **Database runtime** — install Docker (needs your sudo once; recommended), install PostgreSQL via apt, or use the `uv` + `pgserver` fallback? This is the only thing blocking M0.
2. **Python pin** — 3.13 via `uv` (recommended) or stay on system 3.14?
3. **Depth vs. breadth** — is the goal the full M0–M6 portfolio build, or a smaller M1–M3 vertical slice first?

Until answered, the plan assumes: **Docker + Python 3.13 + full M0–M6**.

---

## 9. First actions (in order)

```bash
# 1. Version control
git init && git add . && git commit -m "docs: blueprint + audit + plan"

# 2. Toolchain (no root required)
curl -LsSf https://astral.sh/uv/install.sh | sh
uv python install 3.13 && uv python pin 3.13

# 3. Database runtime (choose one)
#    a) Docker — requires sudo once
sudo apt-get install -y docker.io docker-compose-v2
#    b) apt Postgres
sudo apt-get install -y postgresql
#    c) no-root fallback (Python 3.12 + pgserver)
uv python install 3.12 && uv venv --python 3.12

# 4. Project skeleton
#    pyproject.toml, app/{main,config}.py, compose.yaml, Makefile, .env.example

# 5. Verify the loop
make bootstrap && make up && make migrate && make test
curl -s localhost:8000/health/live
```

Then write ADR-000…011 and start M1. Do not start M2 until ADR-003 (idempotency), ADR-004 (ledger immutability), and ADR-005 (refund capacity) are merged — those three determine schema you would otherwise migrate twice.
