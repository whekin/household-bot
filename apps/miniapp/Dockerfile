# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.10 AS deps
WORKDIR /app

COPY bun.lock package.json tsconfig.base.json ./
COPY apps/bot/package.json apps/bot/package.json
COPY apps/miniapp/package.json apps/miniapp/package.json
COPY packages/application/package.json packages/application/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/ports/package.json packages/ports/package.json

RUN bun install --frozen-lockfile

FROM deps AS build
WORKDIR /app

COPY apps/miniapp ./apps/miniapp

RUN bun run --filter @household/miniapp build

FROM nginx:1.27-alpine AS runtime

COPY apps/miniapp/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/miniapp/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1
