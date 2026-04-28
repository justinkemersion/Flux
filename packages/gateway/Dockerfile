# syntax=docker/dockerfile:1
#
# Build from the monorepo root (needed for pnpm workspace + lockfile):
#   docker build -f packages/gateway/Dockerfile -t flux-gateway .
#
# Run (example — align container names, secrets, and pool URL with your engine):
#   docker run -d \
#     --name flux-node-gateway \
#     --network flux-network \
#     -p 4000:4000 \
#     -e FLUX_SYSTEM_DATABASE_URL="postgresql://postgres:<password>@flux-5y57e70-flux-system-db:5432/postgres" \
#     -e FLUX_POSTGREST_POOL_URL="http://flux-ffca33f-yeastcoast-api:3000" \
#     -e FLUX_GATEWAY_JWT_SECRET="<must match PGRST_JWT_SECRET on the pool PostgREST>" \
#     -e FLUX_BASE_DOMAIN="vsl-base.com" \
#     flux-gateway

FROM node:22-bookworm-slim AS build
WORKDIR /w

ENV NODE_ENV=development

RUN corepack enable pnpm

# Only this package’s sources + the minimum workspace `package.json` set so the lockfile resolves.
# (Avoids sending `apps/dashboard` app sources in the build context.)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/gateway ./packages/gateway
COPY packages/core/package.json ./packages/core/package.json
COPY packages/cli/package.json ./packages/cli/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json
COPY packages/engine-v1/package.json ./packages/engine-v1/package.json
COPY packages/engine-v2/package.json ./packages/engine-v2/package.json
COPY apps/dashboard/package.json ./apps/dashboard/package.json

RUN pnpm install --frozen-lockfile

# ESM bundle: keep node_modules resolution for native/runtime externals (e.g. pg, ioredis).
RUN pnpm dlx esbuild packages/gateway/src/server.ts \
  --bundle \
  --platform=node \
  --format=esm \
  --outfile=packages/gateway/dist/server.mjs \
  --packages=external

RUN pnpm --filter @flux/gateway deploy --legacy --prod /out \
  && cp /w/packages/gateway/dist/server.mjs /out/server.mjs

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /out/ /app/

RUN chown -R node:node /app
USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
