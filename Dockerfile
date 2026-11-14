# syntax=docker/dockerfile:1.7
# Noterat's core: one container with the server, its SQLite database and the app's web build. Everything
# it keeps lives in /data. (Speech to text and OCR come as a second, optional container in phase 2.)
#
# The build uses the full node image (python3, make and g++, in case better-sqlite3 has to compile);
# the runtime uses -slim. Both are Debian bookworm / glibc, so the native module moves across.
ARG NODE_BUILD_IMAGE=node:22-bookworm
ARG NODE_RUN_IMAGE=node:22-bookworm-slim

# ───────────── 1. build ─────────────
FROM ${NODE_BUILD_IMAGE} AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/app/package.json apps/app/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
# what the bundled server needs beside it: better-sqlite3 (native), at the version it was built with
RUN mkdir /runtime && cd /runtime \
 && node -e "const v = require('/src/node_modules/better-sqlite3/package.json').version; require('fs').writeFileSync('package.json', JSON.stringify({ private: true, dependencies: { 'better-sqlite3': v } }))" \
 && npm install --omit=dev --no-audit --no-fund

# ───────────── 2. runtime ─────────────
FROM ${NODE_RUN_IMAGE} AS run
ARG NOTERAT_VERSION=dev
LABEL org.opencontainers.image.title="Noterat" \
      org.opencontainers.image.description="Shared notes, journal, voice memos, lists, finances, calendar, recipes and a document scanner; self-hosted and offline first" \
      org.opencontainers.image.source="https://github.com/svennefenne/noterat"
RUN apt-get update && apt-get install -y --no-install-recommends gosu tini tzdata ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    WEB_DIR=/app/web \
    NOTERAT_VERSION=${NOTERAT_VERSION} \
    PUID=99 PGID=100 UMASK=002 \
    TZ=Europe/Stockholm
COPY --from=build /runtime/node_modules ./node_modules
COPY --from=build /src/apps/server/dist/ ./
COPY --from=build /src/apps/app/dist/ ./web/
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh && mkdir -p /data
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
CMD ["node", "--enable-source-maps", "server.mjs"]
