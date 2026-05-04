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

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/public ./apps/dashboard/public

USER nextjs
EXPOSE 3000
CMD ["node", "apps/dashboard/server.js"]
