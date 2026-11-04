#!/bin/sh
set -eu

# Render mounts the persistent disk at runtime. The mount can arrive owned by
# root even though /data is created for payflow in the image. When the container
# starts as root, take ownership of the disk and re-execute as payflow.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  chown -R payflow:payflow /data 2>/dev/null || true
  exec gosu payflow "$0" "$@"
fi

# Seeding is idempotent: an existing workspace is left intact. On a brand-new
# volume this creates the demo merchants, activity, webhook endpoint and
# /data/demo-key.json. Set PAYFLOW_SEED_ON_BOOT=false to skip this step.
if [ "${PAYFLOW_SEED_ON_BOOT:-true}" = "true" ]; then
  node /app/apps/api/dist/seed.js
fi

exec node /app/apps/api/dist/server.js
