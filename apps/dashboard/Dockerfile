# syntax=docker/dockerfile:1
# Monorepo build: run from repository root, e.g.
#   docker build -f apps/dashboard/Dockerfile -t flux-web .

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Full monorepo (see repo-root .dockerignore); CLI dist must exist before dashboard
# build so /api/install/cli can stream packages/cli/dist/index.cjs from the image.
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @flux/cli run build
RUN pnpm --filter dashboard run build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
# docker-cli reads ${HOME}/.docker/config.json; without this, uid 1001 may inherit HOME=/root and warn / fail.
ENV HOME=/app
ENV DOCKER_CONFIG=/app/.docker

# `flux migrate` (and related routes) run `pg_dump` against the shared cluster from this process.
# util-linux provides `setpriv` so the entrypoint can drop to `nextjs` without losing the docker GID (see flux-web-entrypoint.sh).
# docker-cli: backup restore verification shells out to `docker run` / `exec` (see project-backups.ts); dockerode alone is not enough.
RUN apk add --no-cache postgresql17-client util-linux docker-cli

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/public ./apps/dashboard/public

COPY docker/web/flux-web-entrypoint.sh /flux-web-entrypoint.sh
RUN chmod +x /flux-web-entrypoint.sh

RUN mkdir -p /app/.docker && chown -R nextjs:nodejs /app/.docker

USER root
EXPOSE 3000
ENTRYPOINT ["/flux-web-entrypoint.sh"]
CMD ["node", "apps/dashboard/server.js"]
