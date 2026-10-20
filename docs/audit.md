# PayFlow — Project Audit

> **Update 2026-10-20:** a runnable M0–M4 slice now exists; see [`status.md`](./status.md).
> The audit below records the repository as it stood before implementation.

> Scope: the repository as it exists on 2026-10-20, plus a line-by-line review of `PayFlow_Project_Blueprint.md` (v1.0, 1,221 lines).
> Companion document: [`plan.md`](./plan.md) — decisions, target layout, and milestone action steps.

---

## 1. What exists today

| Item | State |
|---|---|
| Files in repo | 1 (`PayFlow_Project_Blueprint.md`, 59 KB) |
| Git repository | **Not initialized** |
| Application code | 0 lines |
| Tests | 0 |
| Migrations | 0 |
| CI / lint config | None |
| Docker / Compose | None |
| `.env.example`, `.gitignore`, `README.md` | None |

The blueprint is a specification, not an implementation. Blueprint §21 ("First development session") is still entirely unchecked, and its first task — *"Create the Git repository and Python virtual environment"* — has not been done.

**Assessment:** the document is unusually strong for a portfolio spec. The work remaining is not "write the plan"; it is "resolve the contradictions in the plan, then execute it."

---

## 2. Environment audit

| Tool | Status | Consequence |
|---|---|---|
| Python | **3.14.4** | Works for the stack, but see the pin recommendation below |
| `pip` / `ensurepip` | **Missing** | `python3 -m venv` creates an env **without pip**; plain `pip install` is impossible today |
| `venv` module | Present | Usable only with `--without-pip` + a bootstrapped installer |
| `uv` | Missing | Recommended fix: installs Python and packages without root |
| Docker / Podman | **Missing** | Blueprint §4 and §21 assume Compose; the entire DB workflow is blocked |
| PostgreSQL / `psql` | **Missing** | No database server or client available |
| Redis | Missing | Not required — blueprint correctly defers it (§4) |
| `make`, `curl`, `git` | Present | Tooling baseline is fine |
| Node.js | 24.22.0 | Available if a JS-based webhook receiver or dashboard is ever wanted |
| Hardware | 8 vCPU, 12 GiB RAM (~5.1 GiB available), 198 GB free | Sufficient for API + worker + Postgres + concurrency tests |
| OS | Ubuntu 26.04.1 LTS | Modern; distro Postgres would be v18+ |
| `sudo` | **Not available non-interactively** | Cannot `apt install` without the user's involvement |

### 2.1 Dependency viability on Python 3.14

Checked against PyPI metadata today:

| Package | Latest | CPython 3.14 wheels |
|---|---|---|
| `psycopg-binary` | 3.3.6 | Yes (manylinux x86_64) |
| `pydantic-core` | 2.50.1 | Yes |
| `sqlalchemy` | 2.1.5 | Yes (C extensions optional) |
| `fastapi`, `uvicorn`, `alembic`, `pytest`, `httpx` | current | Pure Python |

So **3.14 is viable**. However, the no-root Postgres fallback (`pgserver`) stops at cp312 wheels (last release June 2024), so it cannot run on 3.13 or 3.14.

**Recommendation:** pin **Python 3.13** via `uv`. It costs nothing, keeps every wheel path open, and preserves a no-root database fallback if Docker is not installed. This is a deviation from "use the system Python" and is recorded as **ADR-000** in the plan.

### 2.2 The one hard blocker

There is **no PostgreSQL runtime and no root access to install one**. Until this is resolved, Milestone 1's acceptance criterion ("migrate the database, create a payment, retrieve it") cannot be met.

Three viable paths, in order of preference:

1. **Install Docker Engine + Compose plugin** (needs the user's sudo password once). Matches blueprint §4/§21, and the same `compose.yaml` runs in CI.
2. **Install PostgreSQL locally** (`sudo apt install postgresql`). Works, but drifts from the documented Compose workflow and must be replicated in CI anyway.
3. **No-root fallback:** `uv python install 3.12` + the `pgserver` dev dependency, which ships bundled Postgres binaries. Keeps the project self-contained, but is non-standard, unmaintained since 2024, and adds a second supported path.

**Decision required before M0 can close.** Recommendation: option 1.

---

## 3. Blueprint strengths (keep these)

1. **Correct prioritization.** The closing principle — data model → contract → state machine → idempotency → ledger → durable work → webhooks → security → performance — is the right order and is rarely followed.
2. **The safety boundary is explicit.** Simulation-only, synthetic customers, no PAN/CVV, no compliance claims (§1, §14, §19).
3. **Unknown ≠ decline.** §7.2 correctly identifies the hardest real-world failure mode and refuses unsafe retries.
4. **Transactional outbox + at-least-once honesty.** §12 rejects "exactly-once delivery" marketing and explains idempotent handlers.
5. **Ledger is the source of truth**, not a mutable balance column (§10).
6. **Concurrency tests are specified as real PostgreSQL tests**, not mocks (§11.4, §16.4).

These are the parts that make the project worth building. The findings below are gaps around them, not reasons to redesign.

---

## 4. Findings

Severity: **Blocker** = cannot start · **High** = must decide before the affected milestone · **Medium** = quality/operability defect · **Low** = polish.

### 4.1 Summary

| ID | Sev | Area | Finding | Resolution | Milestone |
|---|---|---|---|---|---|
| F1 | Blocker | Environment | No Postgres, Docker, or sudo; `pip` missing (§4, §21) | Choose a DB runtime; bootstrap with `uv` | M0 |
| F2 | High | API contract | Idempotency semantics for async create are undefined (§3.3, §6.6, §11.2) | ADR-003: 409 in-progress, replay stored 202 for 24 h | M2 |
| F3 | High | Layout | Duplicate idempotency module: `app/core/idempotency.py` **and** `app/idempotency/` (§5) | Keep the package; `core/` holds primitives only | M0 |
| F4 | High | Schema | `outbox_events` has no lease/claim columns, yet §12.3 requires leases | Add `claimed_by`, `lease_expires_at`, partial index | M1/M2 |
| F5 | High | Schema | Ledger tables cannot enforce §10.3 invariants (no journal currency, no reversal ref, no immutability) | Extended schema + trigger + restricted DB role | M3 |
| F6 | High | Refunds | Capacity invariant has no reservation model or refund status enum (§6.4, §9.7) | Lock payment row; `reserved/processing/succeeded` statuses | M4 |
| F7 | High | State machine | `failed` is both terminal decline and retryable transient error (§6.3 vs §7.1) | Terminal `failed`; transient keeps `processing`; timeout → `unknown` | M2 |
| F8 | Medium | Reconciliation | `unknown` is unresolvable: adapter has no lookup method (§6.3, §7.2) | Add `lookup(reference)` to processor protocol | M2 |
| F9 | Medium | Money | SQL type, bounds, currency allowlist, minor-unit exponent never pinned (§6.5, §9.3) | `BIGINT`, `1..10^11`, `currency IN ('INR')`, documented exponent | M1 |
| F10 | Medium | API | No way to discover `account_id`; §8.3 starts at `/accounts/{id}` | Add `GET /v1/accounts` (merchant-scoped) | M3 |
| F11 | Medium | Security | Webhook secret encryption is hand-waved (§9.8) | Fernet + env key; refuse default outside `ENV=dev` | M5 |
| F12 | Medium | Security | Rate limiting named, no backing store (§14) | In-process v1, documented single-process limitation | M6 |
| F13 | Medium | Ops | Metrics listed but no endpoint/library/cardinality policy (§17.2) | `prometheus-client`, internal-only `/metrics`, label allowlist | M6 |
| F14 | Medium | Errors | Stable error codes required, none enumerated; 400-vs-422 left open (§15) | `ErrorCode` enum + `docs/errors.md`; 422 schema, 400 semantic | M1 |
| F15 | Medium | Async | Outbox and `webhook_deliveries` both own retry state (§9.8) | Outbox = fanout once; deliveries own per-endpoint retries | M5 |
| F16 | Medium | Schema | `payment_attempts.status`, `refunds.status`, endpoint lifecycle undefined (§9.4, §9.7) | Publish enum tables + DB `CHECK`s | M2/M4 |
| F17 | Medium | API | `confirm`/`cancel` rules underspecified; cancel/worker race unaddressed (§8.1 vs §7.1) | Conditional `UPDATE ... WHERE status='created'` guard | M2 |
| F18 | Medium | API | Cursor format, tie-break ordering, response envelope unspecified (§8.6) | Opaque `(created_at, id)` cursor + `has_more` envelope | M1 |
| F19 | Medium | DB security | "Restrict database permissions" has no role/grant plan (§10.3) | `payflow_app` role, `REVOKE UPDATE, DELETE` on ledger tables | M3 |
| F20 | Medium | Testing | No test-DB strategy or isolation model (§16) | Real PG, truncate per test, separate concurrency marker | M1 |
| F21 | Low | Validation | `customer_id` has no contract (§9.3) | Opaque string, `^[A-Za-z0-9_-]{1,64}$`, no FK | M1 |
| F22 | Low | Security | Body-size, string-length, CORS, proxy-header values unnamed (§14) | Explicit constants in `config.py` | M1 |
| F23 | Low | Ops | Retention undefined for idempotency, deliveries, dead letters (§6.6, §8.4) | `docs/operations.md` retention table | M6 |
| F24 | Low | Docs | `docs/decisions/` exists in layout but no ADR template or index | Template + 7 initial ADRs | M0 |
| F25 | Low | Layout | Missing CI workflow, `compose.yaml`, `tests/conftest.py`, `docs/errors.md`, `.editorconfig`, `LICENSE` | Added in the target layout | M0 |
| F26 | Low | Portfolio | No LICENSE, demo script, or recorded walkthrough plan | `LICENSE` (MIT), `scripts/demo.sh` | M6 |

### 4.2 Detail on the high-severity findings

#### F2 — Idempotency is specified three times, resolved zero times

§11.2 gives the claim algorithm. §6.6 then explicitly defers the hard part: *"define what a concurrent caller receives"* and *"decide whether the idempotent create response is immutable while resource retrieval remains current."* §3.3 and §8.1 then return `202 Accepted`.

Three distinct behaviours are entangled, and each changes the API contract:

1. **Concurrent duplicate, first still in flight** — block, return `409`, or wait?
2. **Replay after completion** — byte-identical stored `202`, or a fresh `200` with live state?
3. **Replay after retention expiry** — reuse the key, or `409` forever?

Unresolved, this produces the worst possible outcome for a portfolio project: tests that assert different semantics in different files. **Resolved in ADR-003** (`plan.md`):

- in-flight duplicate → `409 idempotency_in_progress` + `Retry-After: 1`
- replay → the stored response **verbatim** (status, body, original `request_id` excluded) for 24 h
- expiry → key becomes reusable; documented
- `GET` is always live and is the documented way to observe current state

#### F4 — The "durable queue" cannot recover from a crashed worker

§9.8's `outbox_events` has `status`, `attempt_count`, `next_attempt_at`, `published_at`. It has **no owner and no lease expiry**. §12.3 requires: *"Record a claim/lease so two workers do not normally handle the same job concurrently"* and *"Recover jobs whose lease expires after a crash."*

Without `claimed_by` + `lease_expires_at`, a crash mid-handler leaves the row `processing` forever. This directly breaks acceptance criterion §19 *"Outbox events survive process restarts."*

Also note the naming collision: §5's `app/outbox/` is described as *jobs*, while §9.8/§13 use "outbox" for *events*. **Resolved by splitting `jobs` (work queue, lease, retry) from `outbox` (event log, fanout)** — see layout.

#### F5 — The ledger schema cannot express its own rules

| Required by §10.3 | Present in §9.6? |
|---|---|
| Balance per currency | Currency is on `ledger_entries`, not the journal — a journal mixing currencies is representable and unverifiable |
| "Reversals … reference the original journal" | No `reversal_of_id` / `reverses_transaction_id` column |
| Posted journals immutable | No mechanism; §10.3 only suggests "restrict database permissions" |
| Journal has a defined lifecycle | `status` exists; values undefined (`draft`/`posted`/`reversed`?) |
| Positive amounts, valid direction | No `CHECK` on `amount > 0` or `direction IN ('debit','credit')` |

`CHECK` cannot sum sibling rows, which §10.3 acknowledges. The intended mechanism — a deferred constraint trigger, or validation in the posting service plus a restricted role — is never chosen. **Resolved in ADR-004:** validate in service inside the transaction, *and* enforce with a `DEFERRABLE INITIALLY DEFERRED` constraint trigger, *and* revoke `UPDATE`/`DELETE` from the application role. Belt and braces, because "immutable" is a claim a reviewer will test.

#### F6 — The refund invariant has no storage model

§6.4 states: `successful_refunds + in_flight_refund_reservations <= eligible_original_amount`. §9.7's `refunds` table has `status` but **no enum and no reservation concept**. §6.4 then says *"if your design reserves capacity while refunds are processing"* — leaving the central concurrency mechanism optional.

Two requests for ₹400 each against a ₹499 payment must not both succeed. With no reservation row, the second request's `SUM` sees nothing in flight and both pass. **Resolved in ADR-005:** refunds enter `reserved` inside the same transaction that locks the payment row (`SELECT ... FOR UPDATE`), and capacity is computed as the sum over `reserved + processing + succeeded`. Partial unique index prevents duplicate active refunds per idempotency key. The alternative (denormalized `payments.refunded_minor` + `reserved_minor`) is faster but adds a second source of truth; rejected for v1.

#### F7 — `failed` means two different things

§6.3: *"Simulate a transient failure and later success on a new safe attempt."*
§7.1: `processing` + *"Definitive decline"* → `failed`, stored as a stable failure code.

If `failed` is terminal, the transient-retry scenario has nowhere to go. If it is retryable, "definitive decline" is meaningless and the failure code cannot be trusted by a merchant. **Resolved:** `failed` is terminal and definitive only. Transient errors keep the payment in `processing` while a new attempt is created (bounded by `max_attempts`); a timeout that cannot be attributed becomes `unknown` and is only resolved by reconciliation. Attempt status is a separate enum: `started → succeeded | declined | errored | timed_out | unknown`.

---

## 5. Invariant → enforcement map

Every invariant in §2 needs a mechanism *and* a test, otherwise it is a comment.

| Invariant (§2) | Enforcement mechanism | Test |
|---|---|---|
| Merchant cannot access another's resource | `merchant_id` predicate in every repository query; no raw `get(id)` helper | `tests/api/test_isolation.py` (one test per route) |
| One idempotency scope/key → one logical operation | `UNIQUE (merchant_id, operation_scope, idempotency_key)` | `tests/concurrency/test_idempotency.py::test_ten_identical_requests_create_one_payment` |
| Key reuse with different body rejected | Request hash compared on claim; `409` | `tests/api/test_idempotency.py::test_reuse_with_different_payload_conflicts` |
| Posted entries immutable; journals balance | Deferred trigger + service validation + revoked grants | `tests/integration/test_ledger.py::test_posted_entry_update_is_rejected` |
| Refunds never exceed eligible amount | Payment row lock + reservation sum | `tests/concurrency/test_refunds.py::test_two_refunds_cannot_exceed_total` |
| Timeout is not a decline | State machine forbids `processing --timeout--> failed` | `tests/unit/test_state_machine.py::test_timeout_moves_to_unknown` |
| Webhooks are at-least-once and safe to duplicate | Stable event ID across attempts; delivery attempt history | `tests/failure/test_webhooks.py::test_retry_reuses_event_id` |

If a mechanism cannot be tested without a live PostgreSQL, that test belongs in `tests/integration/` or `tests/concurrency/`, never mocked.

---

## 6. Verdict

**Green light to build, with M0 redefined.** The blueprint's architecture and sequencing are sound; the defects are specification-level ambiguities that will otherwise surface as rework in Milestones 2–5. Two changes to the roadmap are mandatory:

1. **Insert M0 (environment + decisions) before Milestone 1.** Without it, nothing runs.
2. **Resolve ADR-001…010 before writing Milestone 2 code.** F2, F4, F5, F6, and F7 each change a schema or a contract that is expensive to change later.

With those two changes, the original 6 milestones remain valid and the 12-session estimate is realistic. The plan in `plan.md` preserves the blueprint's milestone numbering and marks every amendment explicitly.
