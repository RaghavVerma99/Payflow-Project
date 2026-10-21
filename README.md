# PayFlow

A payment-processing simulator implementing the mechanics of a production
payment system: idempotent writes, a guarded state machine, durable background
processing, bounded refunds, and a double-entry ledger, with a React operations
console.

|                   |                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| **Stack**         | TypeScript · Fastify 5 · Zod 4 · Drizzle ORM · SQLite (WAL) · React 19 · Vite 7 · Tailwind 4 · TanStack Query |
| **Runtime**       | One Node process (API and worker), one SQLite file, no external services                                      |
| **Tests**         | 24 API tests, CI-gated through `npm run verify`                                                               |
| **Documentation** | This file is the reference; [`DEEP_DIVE.md`](./DEEP_DIVE.md) explains the concepts behind it                  |

> **Simulation only.** No card data is accepted, no processor is contacted, and no
> money moves. All amounts are integer paise held in a local SQLite database.

Included: API-key authentication with merchant-scoped access, idempotent payment
and refund creation, explicit state machines, a durable job queue with leases,
backoff and dead letters, a deterministic processor simulator, a double-entry
ledger with immutable journals, refund capacity reserved atomically under
contention, cursor pagination, a uniform error envelope, request identifiers,
and an operations console.

Excluded by design: real card data and PCI scope, real processors, webhooks and
outbox delivery, message brokers, PostgreSQL, multi-currency, fees, chargebacks,
disputes, payouts, and user accounts.

---

## 1. Design decisions

| Area               | Decision                                            | Rejected                            | Rationale                                                                                                 |
| ------------------ | --------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Write semantics    | `202 Accepted` with polling                         | `200` with a non-final body         | The processor has not been called; a final-looking response invites clients to act on unsettled payments. |
| Idempotency        | Client key, body fingerprint, stored response       | Server-side deduplication by amount | Only the client can determine that two requests express one intent.                                       |
| Key lifetime       | 24-hour TTL, then reusable                          | Permanent replay                    | A key is a retry token, not a durable lock.                                                               |
| Uncertain outcomes | `unknown` state with reconciliation                 | Treating a timeout as a failure     | A timeout may be a capture; failing it silently loses money.                                              |
| Concurrency        | One atomic conditional `UPDATE`                     | Read-then-write, row locks          | No check/write window, and the pattern ports to PostgreSQL unchanged.                                     |
| Storage            | SQLite in WAL mode                                  | PostgreSQL                          | Real transactions, constraints and triggers with no infrastructure to operate.                            |
| Queuing            | A `jobs` table with leases                          | Redis or a broker                   | Leases, backoff and dead letters without a second service.                                                |
| Delivery           | At-least-once with idempotent handlers              | Exactly-once                        | Exactly-once delivery is not achievable; idempotency is.                                                  |
| Money              | Integer minor units                                 | Floating point, decimals            | Exact arithmetic and straightforward auditing.                                                            |
| Accounting         | Derived balances, immutable journals                | Stored balances, mutable entries    | Stored balances drift; immutable entries cannot be rewritten.                                             |
| Tenancy            | `404` for another merchant's resource               | `403`                               | `403` discloses that the resource exists.                                                                 |
| Authentication     | HMAC with a server-side pepper, timing-safe compare | Plain SHA-256 of the key            | The pepper defeats offline cracking; the compare defeats timing leaks.                                    |

---

## 2. Architecture

```mermaid
flowchart LR
    subgraph Browser
        UI["React console<br/>Overview · Payments · Refunds<br/>Ledger · Playground · Guide"]
    end
    subgraph Node["Node process"]
        API["Fastify API<br/>Zod contracts · bearer auth · OpenAPI"]
        W["Worker loop<br/>claim → simulate → settle"]
        SIM["Deterministic simulator<br/>approve · decline · timeout · transient"]
    end
    DB[("SQLite WAL<br/>data/payflow.db")]
    LEDGER["Double-entry ledger<br/>2 accounts · immutable entries"]

    UI -->|"Bearer key"| API
    API -->|"one IMMEDIATE transaction"| DB
    W -->|"lease jobs"| DB
    W --> SIM
    W --> LEDGER
    LEDGER --> DB
```

```text
POST /v1/payments
  1. authenticate   bearer key → HMAC lookup → merchant context
  2. validate      Zod: integer amount_minor > 0, currency = INR
  3. commit        BEGIN IMMEDIATE → payment + event + job + idempotency record
  4. respond       202 { status: "created" }, Location header
  5. process       worker claims job → records attempt → calls the simulator
                   approve → succeeded + journal       decline → failed
                   error   → retry with backoff         timeout → unknown + reconcile
```

Routes never execute SQL directly. Services own the business rules, and the
worker reuses the same service functions, so each rule has one implementation.

---

## 3. Quick start

Node 22 or newer is required. No database server or container is required.

```bash
npm install
npm run seed     # merchants, 14 days of demo history, data/demo-key.json
npm run dev      # API on :4000, console on :5173
```

| Surface           | URL                                       |
| ----------------- | ----------------------------------------- |
| Console           | http://localhost:5173                     |
| API               | http://localhost:4000                     |
| OpenAPI UI / JSON | http://localhost:4000/docs · `/docs/json` |
| Health            | http://localhost:4000/health              |

**Authentication.** The console offers a demo sign-in, which reads the seeded key
through the development-only `GET /v1/demo/session`, or accepts a pasted API
key. The key is written to `data/demo-key.json` with mode `0600` and is printed
once by the seed script.

```bash
KEY=$(node -e "console.log(JSON.parse(require('fs').readFileSync('data/demo-key.json','utf8')).api_key)")

curl -s -X POST http://localhost:4000/v1/payments \
  -H "Authorization: Bearer $KEY" \
  -H "Idempotency-Key: order_1042_attempt_1" \
  -H "Content-Type: application/json" \
  -d '{"amount_minor":24900,"currency":"INR","customer_id":"cus_demo_101","description":"Order #1042","simulator_scenario":"approve"}'
```

---

## 4. Core concepts

**Money.** Amounts are integers in paise; `amount_minor` is authoritative and
`amount` is derived for display. `refundable_minor = amount_minor −
refunded_minor − refund_reserved_minor`. All arithmetic is integer, and rounding
occurs only at the serialization boundary.

**Payment states.**

```mermaid
stateDiagram-v2
    [*] --> created
    created --> processing: worker claim
    created --> canceled: cancel API
    processing --> succeeded: approve
    processing --> failed: decline
    processing --> unknown: timeout
    unknown --> succeeded: reconcile
    unknown --> failed: reconcile
    succeeded --> partially_refunded: partial refund settles
    succeeded --> refunded: full refund settles
    partially_refunded --> partially_refunded: another partial settles
    partially_refunded --> refunded: remaining refund settles
    failed --> [*]
    canceled --> [*]
    refunded --> [*]
```

`failed`, `canceled` and `refunded` are terminal; `unknown` is unresolved and
may still become `succeeded` or `failed`. Any other transition is rejected with
`409 invalid_state_transition`, and every transition writes a
`payment_events` row that serves as the timeline and the audit trail.

**Refund states.**

```mermaid
stateDiagram-v2
    [*] --> reserved: create + reserve capacity
    reserved --> processing: worker claim
    reserved --> canceled: cancel API
    processing --> succeeded: approve
    processing --> failed: decline (reservation released)
    processing --> unknown: timeout
    processing --> reserved: transient error, job retry
    unknown --> succeeded: reconcile
    unknown --> failed: reconcile
```

Only `succeeded` and `partially_refunded` payments are refundable, and omitting
`amount_minor` refunds the entire remaining balance.

**Idempotency.** Keys are scoped to `(merchant_id, operation, idempotency_key)`
and the body is fingerprinted with `sha256`. The record, the business write and
the stored response commit in one transaction, so a replay returns the original
response body. A different body yields `409 idempotency_key_reused`, a request
still in flight yields `409 idempotency_in_progress`, and a key past its TTL
starts a new operation.

**Capacity reservation.** One atomic conditional update holds refund capacity,
so concurrent refunds cannot consume the same headroom:

```sql
UPDATE payments
SET refund_reserved_minor = refund_reserved_minor + :amount
WHERE id = :id
  AND status IN ('succeeded','partially_refunded')
  AND refunded_minor + refund_reserved_minor + :amount <= amount_minor;
```

A result of `changes !== 1` yields `409 refund_exceeds_remaining`. Declined and
canceled refunds release their reservation.

**Durable jobs.** `process_payment`, `process_refund`, `reconcile_payment` and
`reconcile_refund` are claimed by a conditional update, leased for 60 seconds,
and retried with `min(300, 2^attempts × 2)` seconds of backoff until the retry
budget is exhausted and the job becomes `dead`. Expired leases return work to
the queue, so a crashed worker loses nothing. Delivery is at-least-once, and
handlers are therefore idempotent.

**Reconciliation.** A timeout is never recorded as a failure. The payment moves
to `unknown`, a reconciliation job is scheduled approximately five seconds
later, and `lookup()` resolves the outcome against the stored processor
reference. The simulator is deterministic, so the same reference always
resolves identically.

**Ledger.** A successful payment debits `processor_clearing` and credits
`merchant_payable`; a refund reverses it. Balances are derived, never stored.
One journal is posted per business event, enforced by
`UNIQUE (source_type, source_id)`, and SQLite triggers reject `UPDATE` and
`DELETE` on ledger entries and `DELETE` on posted journals, so immutability is
enforced rather than asserted. Failed payments and failed refunds post no
journal.

---

## 5. API

Base URL `http://localhost:4000`. Requests require
`Authorization: Bearer sk_test_…`; writes require `Content-Type: application/json`.

| Method | Path                       | Auth | Purpose                                             |
| ------ | -------------------------- | ---- | --------------------------------------------------- |
| `GET`  | `/health`                  | No   | Liveness, database check, worker state, queue depth |
| `GET`  | `/v1/demo/session`         | No   | Seeded demo key (development only)                  |
| `GET`  | `/v1/merchants/me`         | Yes  | Current merchant and environment                    |
| `POST` | `/v1/payments`             | Yes  | Create a payment; `202`                             |
| `GET`  | `/v1/payments`             | Yes  | List payments; `status` filter, cursor pagination   |
| `GET`  | `/v1/payments/:id`         | Yes  | Payment with attempts and events                    |
| `POST` | `/v1/payments/:id/cancel`  | Yes  | Cancel a `created` payment                          |
| `GET`  | `/v1/payments/:id/refunds` | Yes  | Refunds of one payment, paginated                   |
| `POST` | `/v1/refunds`              | Yes  | Create a refund; `202`                              |
| `GET`  | `/v1/refunds`              | Yes  | List refunds; `status` and `payment_id` filters     |
| `GET`  | `/v1/refunds/:id`          | Yes  | One refund                                          |
| `POST` | `/v1/refunds/:id/cancel`   | Yes  | Cancel a reserved refund and release its capacity   |
| `GET`  | `/v1/accounts`             | Yes  | Accounts and trial balance                          |
| `GET`  | `/v1/ledger/journals`      | Yes  | Posted journals, paginated                          |
| `GET`  | `/v1/stats/overview`       | Yes  | Dashboard aggregates                                |
| `GET`  | `/v1/stats/timeseries`     | Yes  | Daily volume, zero-filled                           |
| `GET`  | `/docs`, `/docs/json`      | No   | OpenAPI 3.1 document and UI                         |

**Simulator scenarios.** Selected with `simulator_scenario` in the body or the
`X-Simulator-Scenario` header; the body takes precedence and `auto` is the
default. Any scenario other than `auto` is rejected when
`PAYFLOW_ALLOW_SIMULATOR_CONTROLS` is false.

| Scenario    | Behaviour                 | Result                                                                       |
| ----------- | ------------------------- | ---------------------------------------------------------------------------- |
| `approve`   | Always approves           | `succeeded`, journal posted                                                  |
| `decline`   | Always declines           | `failed`, `card_declined`, no journal                                        |
| `timeout`   | No answer returned        | `unknown`, then reconciled after approximately five seconds                  |
| `transient` | First attempt errors      | Retry succeeds; two attempts recorded                                        |
| `auto`      | `sha256(reference) % 100` | 78% success, 3.2% decline, 6% timeout, remainder resolved through `lookup()` |

**Pagination.** Keyset pagination is used rather than offsets. The cursor
encodes `created_at|id` and orders by `created_at DESC, id DESC`, so pages
remain stable while rows are inserted. Responses contain `data`, `has_more` and
`next_cursor`; `limit` accepts `1 … PAYFLOW_MAX_PAGE_SIZE` and defaults to
`PAYFLOW_DEFAULT_PAGE_SIZE`.

**Errors.** All failures use one envelope, and `request_id` is also returned in
the `x-request-id` response header. Validation failures add a `details` array.

```json
{
  "error": {
    "code": "idempotency_key_reused",
    "message": "This idempotency key was already used with a different request body.",
    "request_id": "req_..."
  }
}
```

| Status | Codes                                                                                                                                                                                    |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | `validation_error`, `invalid_request`, `invalid_cursor`, `unsupported_currency`, `invalid_scenario`                                                                                      |
| `401`  | `unauthorized`                                                                                                                                                                           |
| `403`  | `simulator_controls_disabled`                                                                                                                                                            |
| `404`  | `not_found`                                                                                                                                                                              |
| `409`  | `idempotency_key_reused`, `idempotency_in_progress`, `refund_exceeds_remaining`, `payment_not_refundable`, `refund_not_cancelable`, `payment_not_cancelable`, `invalid_state_transition` |
| `429`  | Rate limit, 600 requests per minute                                                                                                                                                      |
| `500`  | `internal_error`                                                                                                                                                                         |

**Representation.** Resources are returned with an `object` discriminator, a
`…_minor` integer and a derived display string:

```json
{
  "object": "payment",
  "id": "pay_2f8c1a…",
  "status": "created",
  "amount_minor": 24900,
  "amount": "249.00",
  "currency": "INR",
  "customer_id": "cus_demo_101",
  "description": "Order #1042",
  "failure_code": null,
  "refunded_minor": 0,
  "refund_reserved_minor": 0,
  "refundable_minor": 24900,
  "created_at": "2026-10-21T09:00:00.000Z",
  "updated_at": "2026-10-21T09:00:00.000Z"
}
```

The eleven tables, their relationships, and the SQLite configuration are
documented in [`DEEP_DIVE.md`](./DEEP_DIVE.md#81-storage-schema).

---

## 6. Console

| Route           | Content                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------- |
| `/`             | Volume summary, animated metrics, trend chart, status composition, live feed, ledger health |
| `/payments`     | Search, filters, creation dialog, detail timeline with attempts and refunds                 |
| `/refunds`      | Refund ledger with status filters and live totals                                           |
| `/ledger`       | Trial balance, account balances, posted journals                                            |
| `/playground`   | Request composer: presets, idempotency key, cURL output, response inspector                 |
| `/guide`        | In-application architecture summary, invariants, endpoints, scenarios                       |
| Unauthenticated | Login, with demo access or an API key                                                       |

Presentation uses an ink and parchment palette with saffron accents, Fraunces
for display, Inter for text and JetBrains Mono for data; status values appear
as semantic colours inside stamped monospace badges. Film grain, an ambient
canvas, count-up metrics, reveal-on-scroll, a live clock and scroll progress
appear in both themes, reduced-motion preferences are respected, and code
surfaces remain dark in the light theme.

Data is fetched through TanStack Query with a two-second stale time and a
single retry. The console polls only where it is useful: every 1.2 seconds
while a payment is active, every 2.5 seconds for the refunds of a payment, every
five seconds for the overview, and every fifteen seconds for the time series.
Mutations invalidate the affected query keys. The API key is stored in
`localStorage["payflow_api_key"]` and the theme in
`localStorage["payflow_theme"]`. No card entry form exists; the only inputs are
amounts, customer references and descriptions.

---

## 7. Configuration

Configuration is read from the process environment by `apps/api/src/config.ts`.
`.env.example` lists every variable. The API does not load `.env` files;
variables must be exported by the invoking environment.

| Variable                           | Default                                      | Purpose                                                  |
| ---------------------------------- | -------------------------------------------- | -------------------------------------------------------- |
| `PAYFLOW_ENV`                      | `dev`                                        | `dev`, `test`, or `production`                           |
| `PAYFLOW_HOST` / `PAYFLOW_PORT`    | `0.0.0.0` / `4000`                           | Listen address                                           |
| `PAYFLOW_DB_PATH`                  | `data/payflow.db`                            | SQLite file, absolute or relative to the repository root |
| `PAYFLOW_API_KEY_PEPPER`           | `dev-pepper-change-me`                       | HMAC pepper for API key hashes                           |
| `PAYFLOW_WORKER_ENABLED`           | `true`                                       | Start the in-process worker                              |
| `PAYFLOW_WORKER_POLL_MS`           | `400`                                        | Queue poll interval                                      |
| `PAYFLOW_WORKER_LEASE_SECONDS`     | `60`                                         | Job lease duration                                       |
| `PAYFLOW_MAX_JOB_ATTEMPTS`         | `5`                                          | Retry budget for newly enqueued jobs                     |
| `PAYFLOW_ALLOW_SIMULATOR_CONTROLS` | `true`                                       | Permit forced scenarios                                  |
| `PAYFLOW_IDEMPOTENCY_TTL_HOURS`    | `24`                                         | Idempotency key lifetime                                 |
| `PAYFLOW_DEFAULT_PAGE_SIZE`        | `25`                                         | Default `limit`                                          |
| `PAYFLOW_MAX_PAGE_SIZE`            | `100`                                        | Maximum `limit`                                          |
| `PAYFLOW_CORS_ORIGIN`              | `true` in development, `false` in production | CORS origin                                              |
| `PAYFLOW_RATE_LIMIT_MAX`           | `600`                                        | Requests per minute                                      |
| `PAYFLOW_LOG_LEVEL`                | `info`                                       | Log level                                                |

In production the service refuses to start when the pepper is still the default
value or when simulator controls are enabled. CORS is disabled unless
configured explicitly. The worker may run in-process or as a separate process.

---

## 8. Operations

| Command                                   | Effect                                                 |
| ----------------------------------------- | ------------------------------------------------------ |
| `npm run dev`                             | API and console                                        |
| `npm run seed`                            | Merchants, demo history, `data/demo-key.json`          |
| `npm test`                                | 24 API tests                                           |
| `npm run typecheck`                       | API and console                                        |
| `npm run build`                           | Console, then API                                      |
| `npm run verify`                          | Quality gate: typecheck, test, build                   |
| `npm run format` / `npm run format:check` | Prettier write / check                                 |
| `npm run worker -w @payflow/api`          | Standalone worker                                      |
| `npm run clean`                           | Remove `apps/*/dist` and `data/`                       |
| `npm start`                               | Run the built API; serves `apps/web/dist` when present |

```bash
npm run clean && npm run seed               # reset the environment
PAYFLOW_WORKER_ENABLED=false npm run dev:api   # worker on a separate process
npm run worker -w @payflow/api
npm run build && npm start                  # production-style run
```

| Symptom                                 | Cause                                             | Resolution                                     |
| --------------------------------------- | ------------------------------------------------- | ---------------------------------------------- |
| Demo sign-in fails                      | Key file missing or stale                         | Run `npm run seed`                             |
| `401 unauthorized`                      | Incorrect key                                     | Read `data/demo-key.json` or re-seed           |
| Payment remains `created`               | Worker not running                                | Check `/health`; start the worker              |
| `409 idempotency_key_reused`            | Same key, different body                          | Use a new key for a new operation              |
| `409 refund_exceeds_remaining`          | Amount above `refundable_minor`                   | Read `refundable_minor` first                  |
| `409 refund_not_cancelable`             | Refund already processing or settled              | Only reserved refunds can be canceled          |
| `409 payment_not_cancelable`            | Worker already started processing                 | Only created payments can be canceled          |
| `404` for another merchant's identifier | Tenant isolation                                  | Expected behaviour                             |
| `SQLITE_BUSY`                           | Long write, or an external process holds the file | One writer; the busy timeout is 30 seconds     |
| Port already in use                     | Another instance is running                       | Stop it, or change the port and the Vite proxy |

---

## 9. Quality

| Group          | Tests | Coverage                                                                                                                                                                            |
| -------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication |     3 | Bearer requirement, rejection of unknown keys, merchant context                                                                                                                     |
| Payments       |     9 | Idempotent replay and conflict, validation, approval, decline, cancellation, transient retry, timeout reconciliation, cursor pagination, tenant isolation                           |
| Refunds        |     6 | Partial refund with reservation and reversing journal, over-capacity rejection, release on decline, timeout reconciliation, per-payment pagination, cancellation releasing capacity |
| Ledger         |     2 | Accounts start balanced; posted entries are immutable                                                                                                                               |
| Analytics      |     2 | Overview and time-series aggregates; health and queue depth                                                                                                                         |
| Configuration  |     2 | Config-driven page size; idempotency TTL expiry                                                                                                                                     |

Tests use an isolated in-memory database, `app.inject()` in place of a network
socket, and explicit worker draining through `runDrain()`. Neither the database
nor the worker is mocked. CI runs `format:check`, `typecheck`, `test` and
`build` on Node 22 (`.github/workflows/ci.yml`); `npm run verify` executes the
same gate locally. Browser tests, multi-process stress tests, real HTTP load
and failure injection outside the simulator are not covered.

---

## 10. Repository layout

```text
apps/api/src/
├── app.ts              Fastify app, auth decorator, error handler, Swagger, static console
├── server.ts           Boot, graceful shutdown, embedded worker
├── worker-cli.ts       Standalone worker process
├── config.ts           Environment parsing and production guards
├── db.ts               SQLite connection, pragmas, schema bootstrap, migrations
├── schema.ts           Drizzle table definitions
├── schema-sql.ts       Raw schema, indexes, immutability triggers
├── domain.ts           Statuses, transitions, errors, identifiers, cursor, simulator
├── schemas.ts          Zod request and response contracts
├── seed.ts             Merchants and fourteen days of synthetic history
├── routes/             HTTP surface: health, payments, refunds, read
├── services/           auth · idempotency · jobs · ledger · payments · refunds ·
│                       serializers · stats
└── app.test.ts         24 API tests

apps/web/src/
├── App.tsx             Router, query client, authentication gate
├── index.css           Design tokens, typography, texture, motion
├── components/         layout · ui · status · ambient · motion · chart · dialogs
├── lib/                api · auth · theme · utils
└── pages/              overview · payments · refunds · ledger · playground · guide · login
```

---

## 11. Known limitations

- SQLite permits a single writer. The patterns used here port to PostgreSQL
  unchanged, but no load testing has been performed there.
- No migration framework exists; schema changes require rebuilding
  `data/payflow.db`.
- One embedded worker is the default. Additional workers are safe, but SQLite
  serializes their writes.
- There are no webhooks, outbox, metrics or tracing backends. Structured logs
  and request identifiers only.
- There is no real processor, no card data, no PCI scope, and no multi-currency,
  fees, chargebacks, disputes or payouts.
- Authentication is limited to bearer API keys; there are no user accounts.

---

## 12. Further reading

[`DEEP_DIVE.md`](./DEEP_DIVE.md) documents the concepts underlying the
implementation: the twelve ideas the system is built on, seven end-to-end
traces including a refund race and a worker crash, the accounting algebra
worked through numerically, the storage schema, change recipes, a debugging
playbook, and eighteen hands-on exercises.
