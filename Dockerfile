# PayFlow production image.
#
# The API serves the built web console from apps/web/dist, so a single
# container provides the console, the API, the docs and the worker on one port.

FROM node:22-bookworm-slim AS build

WORKDIR /app

# better-sqlite3 ships prebuilt binaries for common platforms. Keep a compiler
# available so the image still builds if a prebuild is unavailable.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm ci

COPY . .

RUN npm run build -w @payflow/web \
  && npm run build -w @payflow/api \
  && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PAYFLOW_ENV=production \
    PAYFLOW_HOST=0.0.0.0 \
    PAYFLOW_DB_PATH=/data/payflow.db

WORKDIR /app

RUN groupadd --system --gid 1001 payflow \
  && useradd --system --uid 1001 --gid payflow --home-dir /app payflow

COPY --from=build --chown=payflow:payflow /app/package.json /app/package-lock.json ./
COPY --from=build --chown=payflow:payflow /app/node_modules ./node_modules
COPY --from=build --chown=payflow:payflow /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=payflow:payflow /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=payflow:payflow /app/apps/web/dist ./apps/web/dist
COPY --from=build --chown=payflow:payflow /app/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p /data \
  && chown payflow:payflow /data

USER payflow

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || process.env.PAYFLOW_PORT || 4000) + '/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
