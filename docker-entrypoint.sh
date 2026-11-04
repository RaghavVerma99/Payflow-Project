#!/bin/sh
set -eu

# Seeding is idempotent: an existing workspace is left intact. On a brand-new
# volume this creates the demo merchants, activity, webhook endpoint and
# /data/demo-key.json. Set PAYFLOW_SEED_ON_BOOT=false to skip this step.
if [ "${PAYFLOW_SEED_ON_BOOT:-true}" = "true" ]; then
  node /app/apps/api/dist/seed.js
fi

exec node /app/apps/api/dist/server.js
