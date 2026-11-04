# PayFlow

A payment operations **simulator** built with Fastify, SQLite, React, and TypeScript. Explore payment lifecycles, retries, refunds, payouts, disputes, signed webhooks, and double-entry accounting through an API and web console.

> **Simulation only.** PayFlow does not accept card numbers, connect to a processor, or move real money. Amounts are integer paise in a SQLite database. It is not a payment service.

A public demo can run on [Render](./DEPLOYMENT.md) as a single Docker service with a persistent disk. The same origin serves the console, API, OpenAPI docs, and background worker.

## Quick start

Requirements: Node.js 22 or newer.

```bash
npm ci
npm run seed
npm run dev
```

Open the console at [http://localhost:5173](http://localhost:5173). The API runs at [http://localhost:4000](http://localhost:4000), with OpenAPI docs at `/docs` and health at `/health`.

The seed command creates sample merchants, activity, and a demo API key at `data/demo-key.json`. The console can sign in with the seeded demo session or a pasted API key. Keep the key file private; it grants access to the demo merchant. Seeding is idempotent, so restarting does not rotate the key or duplicate data.

## What’s included

- Merchant-scoped API keys, request validation, consistent errors, and OpenAPI documentation
- Idempotent payment, refund, and payout requests
- Deterministic processor outcomes, job leases, retries, dead letters, reconciliation, and safe dead-job replay
- Immutable double-entry journals, balance-bounded payouts, and dispute accounting
- Tokenized payment method metadata; card numbers are not accepted or stored
- Transactional webhook outbox, HMAC signatures, delivery history, and retry
- Operations console for payments, refunds, ledger, treasury, methods, webhooks, and API exploration

## Useful commands

```bash
npm run dev        # Start API and console
npm run seed       # Create demo data if the database is empty
npm run seed:reset # Delete the database and rebuild demo data
npm run typecheck  # Check API and console TypeScript
npm test           # Run API tests
npm run build      # Build both applications
npm run verify     # Typecheck, tests, and production build
```

## Configuration

Copy `.env.example` to `.env` to override defaults. The API reads environment variables directly; npm scripts do not load `.env` automatically, so export variables in your shell or use a tool such as `dotenv-cli`.

Local development binds to `127.0.0.1:4000`. In production, set an absolute `PAYFLOW_DB_PATH`, a unique `PAYFLOW_API_KEY_PEPPER`, and `PAYFLOW_ALLOW_SIMULATOR_CONTROLS=false` unless you are running the public demo.

### Demo mode

Set `PAYFLOW_DEMO_MODE=true` to run a public showcase while keeping production guards:

- `GET /v1/demo/session` returns the seeded demo key
- simulator scenarios such as `approve`, `decline`, and `timeout` stay enabled
- the in-process webhook sink is available at `/_sink/demo`
- `POST /v1/demo/reset` becomes available when `PAYFLOW_DEMO_RESET_TOKEN` is set

Demo mode never permits wildcard CORS and still requires a non-default API key pepper. See [DEPLOYMENT.md](./DEPLOYMENT.md) for the Render walkthrough, reset command, and security notes.

## Deploying to Render

The repository includes a [`render.yaml`](./render.yaml) Blueprint, a production [`Dockerfile`](./Dockerfile), and a first-boot entrypoint that seeds an empty disk. The service runs a single instance because SQLite and the in-process worker are not horizontally scalable.

1. Push the repository to GitHub or GitLab.
2. In Render, choose **New → Blueprint** and select the repository.
3. Apply the Blueprint. It provisions one Docker web service and a 1 GB disk at `/data`.
4. Open the service URL and click **Open the demo workspace**.

Full instructions, the environment matrix, reset workflow, and troubleshooting are in [DEPLOYMENT.md](./DEPLOYMENT.md).

## Project layout

```text
apps/api/  Fastify API, SQLite schema and migrations, worker, simulator
apps/web/  React operations console
```

See [DEEP_DIVE.md](./DEEP_DIVE.md) for state machines, accounting rules, storage details, and walkthroughs.

## Scope

PayFlow is a learning and demonstration project, not a payment service. It intentionally has no real processor integration, card data, multi-currency support, fees, subscriptions, user accounts, or external message broker. SQLite keeps setup simple; a deployment must run a single instance and mount persistent storage.
