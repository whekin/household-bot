# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.10-alpine AS deps
WORKDIR /app

COPY bun.lock package.json tsconfig.base.json ./
COPY apps/bot/package.json apps/bot/package.json
COPY apps/miniapp/package.json apps/miniapp/package.json
COPY infra/pulumi/aws/package.json infra/pulumi/aws/package.json
COPY packages/adapters-db/package.json packages/adapters-db/package.json
COPY packages/application/package.json packages/application/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/ports/package.json packages/ports/package.json
COPY scripts/package.json scripts/package.json

RUN bun install --frozen-lockfile

FROM deps AS build
WORKDIR /app

COPY apps ./apps
COPY packages ./packages

RUN bun run --filter @household/bot build \
  && mkdir -p packages/db/dist \
  && bun build packages/db/src/migrate.ts --outdir packages/db/dist --target bun

FROM oven/bun:1.3.10-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /app/apps/bot/dist ./apps/bot/dist
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/drizzle ./packages/db/drizzle

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.PORT ?? '8080') + '/healthz').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "apps/bot/dist/index.js"]
