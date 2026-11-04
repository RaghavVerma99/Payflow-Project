# Deploying PayFlow on Render

PayFlow is a payment-operations **simulator**. Deploy it as a reference
implementation or public demo; it never moves real money or stores card data.

The recommended deployment is a **single Docker web service** with a **persistent
disk** mounted at `/data`. The API serves the built React console, `/docs`, and
the worker from the same origin, so there is no CORS or separate static host to
configure.

```text
Browser ── HTTPS ──► Render service (one instance)
                       ├─ Fastify API
                       ├─ React console (apps/web/dist)
                       ├─ OpenAPI docs at /docs
                       ├─ background worker
                       └─ /data/payflow.db + /data/demo-key.json
```

## Prerequisites

- A Render account.
- This repository pushed to GitHub or GitLab.
- The **Starter** plan (or higher). Persistent disks are not available on the
  free plan, and a free web service sleeps, which stops the worker.

## Option A — Blueprint (recommended)

1. Push the repository to a Git provider.
2. In Render, choose **New → Blueprint**.
3. Select the repository. Render reads [`render.yaml`](./render.yaml) and shows
   the `payflow` web service, its 1 GB disk at `/data`, and the health check.
4. Apply the Blueprint.
5. Wait for the image build and the first boot. The entrypoint seeds the demo
   workspace automatically and writes `/data/demo-key.json`.
6. Open the service URL. Click **Open the demo workspace** on the sign-in page.

`render.yaml` generates values for `PAYFLOW_API_KEY_PEPPER` and
`PAYFLOW_DEMO_RESET_TOKEN`. The pepper is used to hash API keys, so keep it
stable across deploys; on a fresh disk PayFlow recreates the demo key if the
pepper changes.

## Option B — Manual web service

Create a **Web Service** with these settings:

| Setting           | Value             |
| ----------------- | ----------------- |
| Runtime           | Docker            |
| Plan              | Starter or higher |
| Dockerfile        | `./Dockerfile`    |
| Docker context    | `.`               |
| Health check path | `/health`         |
| Instances         | `1`               |

Add a persistent disk:

| Disk setting | Value          |
| ------------ | -------------- |
| Name         | `payflow-data` |
| Mount path   | `/data`        |
| Size         | 1 GB           |

Add these environment variables:

| Variable                           | Value              |
| ---------------------------------- | ------------------ |
| `NODE_ENV`                         | `production`       |
| `PAYFLOW_ENV`                      | `production`       |
| `PAYFLOW_DEMO_MODE`                | `true`             |
| `PAYFLOW_ALLOW_SIMULATOR_CONTROLS` | `true`             |
| `PAYFLOW_HOST`                     | `0.0.0.0`          |
| `PAYFLOW_DB_PATH`                  | `/data/payflow.db` |
| `PAYFLOW_WORKER_ENABLED`           | `true`             |
| `PAYFLOW_LOG_LEVEL`                | `info`             |
| `PAYFLOW_API_KEY_PEPPER`           | long random secret |
| `PAYFLOW_DEMO_RESET_TOKEN`         | long random secret |

Render injects `PORT`; PayFlow reads it automatically. Leave
`PAYFLOW_CORS_ORIGIN` unset because the console and API share one origin.

## What demo mode changes

Demo mode keeps production guards in place (a non-default pepper is required and
wildcard CORS is rejected) while enabling:

- `GET /v1/demo/session`, which returns the seeded demo key
- simulator scenario controls such as `approve`, `decline`, and `timeout`
- the in-process webhook sink at `/_sink/demo`
- `POST /v1/demo/reset`

Without `PAYFLOW_DEMO_MODE=true`, production requires
`PAYFLOW_ALLOW_SIMULATOR_CONTROLS=false` and the demo session is unavailable.

## First boot and seeding

`docker-entrypoint.sh` runs `node dist/seed.js` before starting the server. It
starts as root only long enough to take ownership of the mounted disk, then
drops to the unprivileged `payflow` user for seeding and serving. Seeding is
**idempotent**:

- A new disk gets two merchants, 14 days of activity, payment methods, a
  dispute, a payout, a webhook endpoint, and `/data/demo-key.json`.
- A restart on an existing disk reuses the existing data and the same demo key.
- Set `PAYFLOW_SEED_ON_BOOT=false` to skip seeding entirely.

To deliberately rebuild the workspace, either call the reset endpoint or use the
Render Shell:

```bash
npm run seed:reset -w @payflow/api
```

`seed:reset` deletes the SQLite database and all demo data. It does not affect
the container image or environment variables.

## Resetting a live demo

With `PAYFLOW_DEMO_RESET_TOKEN` set:

```bash
curl -X POST https://YOUR-SERVICE.onrender.com/v1/demo/reset \
  -H "x-demo-reset-token: $PAYFLOW_DEMO_RESET_TOKEN"
```

The reset preserves merchants and API keys, so signed-in browsers stay valid,
then reseeds payments, refunds, methods, disputes, payouts, and ledger entries.
It returns a summary such as:

```json
{
  "object": "demo_reset",
  "merchant": { "id": "mer_acme", "name": "Acme Store" },
  "payments": 45,
  "refunds": 6,
  "methods": 5,
  "endpoints": 1,
  "disputes": 1,
  "payouts": 1,
  "reset_at": "2026-11-04T12:00:00.000Z"
}
```

Protect the reset token like an admin password. Without the token the endpoint
returns `404`, and a wrong token returns `401`.

## Local production check

Build and run the same artifacts without Render:

```bash
docker build -t payflow .
docker run --rm -p 4000:4000 \
  -v payflow-data:/data \
  -e PAYFLOW_DEMO_MODE=true \
  -e PAYFLOW_ALLOW_SIMULATOR_CONTROLS=true \
  -e PAYFLOW_API_KEY_PEPPER=replace-with-a-long-random-secret \
  -e PAYFLOW_DEMO_RESET_TOKEN=replace-with-an-admin-token \
  payflow
```

Then verify:

```bash
curl http://localhost:4000/health
curl http://localhost:4000/v1/demo/session
```

Open `http://localhost:4000` for the console and `/docs` for OpenAPI.

If Docker is unavailable, the equivalent local check is:

```bash
npm run build
PAYFLOW_DEMO_MODE=true \
PAYFLOW_ALLOW_SIMULATOR_CONTROLS=true \
PAYFLOW_API_KEY_PEPPER=replace-with-a-long-random-secret \
PAYFLOW_DEMO_RESET_TOKEN=replace-with-an-admin-token \
PAYFLOW_DB_PATH=./data/payflow.db \
PORT=4000 \
node apps/api/dist/seed.js
PORT=4000 node apps/api/dist/server.js
```

On PowerShell, set the variables with `$env:NAME = "value"` before each command.

## Operations checklist

- Keep exactly **one instance**. SQLite and the in-process worker are not
  designed for horizontal scaling.
- Keep the disk mounted at `/data`; otherwise every deploy starts empty.
- Monitor `GET /health`. It checks SQLite and reports queue depth.
- Watch logs for `request.failed`, `worker.failed`, and repeated webhook retries.
- Do not expose a real API key or reset token in screenshots or recordings.
- Treat the deployment as a shared demo workspace unless you add per-visitor
  merchant isolation.
- Back up `/data/payflow.db` before changing the schema or doing a long demo.
  Render disk snapshots or a copy from the Render Shell are both suitable.

## Troubleshooting

| Symptom                             | Likely cause                             | Fix                                                                                                     |
| ----------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Build fails on `better-sqlite3`     | Missing native build tools               | The Dockerfile installs Python and a C++ toolchain; rebuild from the repo root.                         |
| `demo_not_seeded`                   | Disk is empty or the key file is missing | Check logs for the seed step, then restart the service.                                                 |
| Demo key stopped working            | Pepper changed on a new disk             | Restart so the entrypoint creates a new key, or run `seed:reset`.                                       |
| Data disappears on deploy           | No disk mounted at `/data`               | Add the persistent disk and set `PAYFLOW_DB_PATH=/data/payflow.db`.                                     |
| Seed fails with `EACCES` on `/data` | Disk mounted root-owned                  | The entrypoint chowns `/data` before dropping privileges; do not override the image user or entrypoint. |
| Webhooks to `/_sink/demo` fail      | Wrong port in the seeded URL             | The seed derives the sink URL from `PORT`; reseed after changing ports.                                 |
| Reset returns `404`                 | Demo mode or reset token is off          | Set `PAYFLOW_DEMO_MODE=true` and `PAYFLOW_DEMO_RESET_TOKEN`.                                            |
| Service sleeps or stops processing  | Free plan or worker disabled             | Use Starter or higher and keep `PAYFLOW_WORKER_ENABLED=true`.                                           |

## Security notes

- This is not a payment processor. Do not send real card data.
- Every visitor to a shared demo signs into the same merchant.
- Private and reserved webhook targets are rejected in production. Demo mode
  only adds loopback delivery so the seeded in-container sink can receive signed
  events.
- At least one active API key must remain; the last key cannot be revoked.
- Rate limiting is IP-based by default. If you put Render behind another proxy,
  review Fastify's `trustProxy` behaviour before relying on client IPs.
