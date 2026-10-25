# PayFlow

A local payment operations simulator built with Fastify, SQLite, React, and TypeScript. Explore payment lifecycles, retries, refunds, payouts, disputes, signed webhooks, and double-entry accounting through an API and web console.

> **Simulation only.** PayFlow does not accept card numbers, connect to a processor, or move real money. Amounts are integer paise in a local SQLite database.

## Quick start

Requirements: Node.js 22 or newer.

```bash
npm ci
npm run seed
npm run dev
```

Open the console at [http://localhost:5173](http://localhost:5173). The API runs at [http://localhost:4000](http://localhost:4000), with OpenAPI docs at `/docs` and health at `/health`.

The seed command creates sample merchants, activity, and a development API key at `data/demo-key.json`. The console can sign in with the seeded demo session or a pasted API key. Keep the key file private; it grants access to the demo merchant.

## What’s included

- Merchant-scoped API keys, request validation, consistent errors, and OpenAPI documentation
- Idempotent payment, refund, and payout requests
- Deterministic processor outcomes, job leases, retries, dead letters, and reconciliation
- Immutable double-entry journals, balance-bounded payouts, and dispute accounting
- Tokenized payment method metadata; card numbers are not accepted or stored
- Transactional webhook outbox, HMAC signatures, delivery history, and retry
- Operations console for payments, refunds, ledger, treasury, methods, webhooks, and API exploration

## Useful commands

```bash
npm run dev       # Start API and console
npm run seed      # Create or reset demo data
npm run typecheck # Check API and console TypeScript
npm test          # Run API tests
npm run build     # Build both applications
npm run verify    # Typecheck, tests, and production build
```

## Configuration

Copy `.env.example` to `.env` to override defaults. The API reads environment variables directly. Local development binds to `127.0.0.1`; set `PAYFLOW_HOST` explicitly when you need another interface. Production requires a unique `PAYFLOW_API_KEY_PEPPER` and `PAYFLOW_ALLOW_SIMULATOR_CONTROLS=false`. Configure `PAYFLOW_CORS_ORIGIN` for the console origin you serve.

## Project layout

```text
apps/api/  Fastify API, SQLite schema and migrations, worker, simulator
apps/web/  React operations console
```

See [DEEP_DIVE.md](./DEEP_DIVE.md) for state machines, accounting rules, storage details, and walkthroughs.

## Scope

PayFlow is a learning and development project, not a payment service. It intentionally has no real processor integration, card data, multi-currency support, fees, subscriptions, user accounts, or external message broker. SQLite keeps setup simple and is intended for local simulation rather than production-scale workloads.
