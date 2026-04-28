# Session Summary — Engine v2, Gateway Caching, and v2 Shared Compose

Date: 2026-04-28

This document summarizes all implementation updates completed in this session so the repo and operational notes stay synchronized.

## 1) `@flux/engine-v2`: tenant bootstrap implemented

Goal completed: remove manual SQL shimming by implementing `provisionProject` Postgres bootstrap for v2 shared mode.

### Files updated

- `packages/engine-v2/src/index.ts`
- `packages/engine-v2/package.json`
- `packages/core/src/standalone.ts`
- `pnpm-lock.yaml`

### What was added

#### `packages/core/src/standalone.ts`

- New helper exported:
  - `deriveShortId(tenantId: string): string`
- Behavior:
  - strips hyphens from UUID
  - lowercases
  - takes first 12 hex chars

#### `packages/engine-v2/src/index.ts`

- Replaced placeholder with concrete implementation:
  - `deriveTenantIdentity(tenantId)`:
    - uses `deriveShortId` from `@flux/core/standalone`
    - builds names:
      - schema: `t_<shortid>_api`
      - role: `t_<shortid>_role`
  - `buildTenantBootstrapSql(identity)`:
    - `CREATE SCHEMA IF NOT EXISTS ...`
    - idempotent role create via `DO $$ IF NOT EXISTS ... CREATE ROLE ...`
    - `GRANT USAGE ON SCHEMA ... TO ...`
    - `ALTER ROLE ... SET search_path = <schema>, public`
    - `GRANT <tenant_role> TO authenticator`
  - `executeBootstrapSql(sql)`:
    - connects via `FLUX_SHARED_POSTGRES_URL`
    - executes SQL
    - ensures cleanup in `finally`
  - `provisionProject({ tenantId })`:
    - derives identity
    - builds SQL
    - executes against shared cluster
    - returns typed result:
      - `tenantId`
      - `shortId`
      - `schema`
      - `role`
  - `EngineV2` class with method `provisionProject(...)` delegating to function implementation.

#### `packages/engine-v2/package.json`

- Added runtime deps:
  - `@flux/core` (workspace)
  - `pg`
- Added dev dep:
  - `@types/pg`

## 2) `@flux/gateway`: tenant-resolution caching + JWT reuse

Goal completed: reduce per-request overhead by maximizing cache hits before proxy forward.

### Files updated

- `packages/gateway/src/cache.ts`
- `packages/gateway/src/tenant-resolver.ts`
- `packages/gateway/src/jwt-issuer.ts`

### What changed

#### Resolver cache TTL alignment

- In-memory resolver cache (`packages/gateway/src/cache.ts`):
  - TTL changed from `8s` to `60s`.
- Redis resolver cache (`packages/gateway/src/tenant-resolver.ts`):
  - TTL changed from `300s` to `60s`.
- Resolver comments updated to reflect new 60-second stale window behavior.

#### JWT reuse cache

- Added local cache in `packages/gateway/src/jwt-issuer.ts` keyed by `tenantId`.
- Behavior:
  - if cached token is still unexpired, return it (skip signing)
  - otherwise mint new token, cache with expiry, return it
- Effective token expiration used by issuer path is bounded to 5 minutes:
  - `effectiveTtl = min(FLUX_GATEWAY_JWT_TTL_SEC, 300)`

## 3) New v2 shared stack compose

Goal completed: add deployable compose topology for v2 shared data plane and wire JWT handshake invariant.

### New file

- `docker/v2-shared/docker-compose.yml`

### Services defined

- `postgres-v2` (shared Postgres cluster)
- `pgbouncer` (transaction pool)
- `postgrest-pool` (shared PostgREST upstream)

### JWT handshake wiring

- `postgrest-pool` uses:
  - `PGRST_JWT_SECRET: ${FLUX_GATEWAY_JWT_SECRET:?...}`
- This ensures PostgREST verifies with the same secret source used by gateway signing.

### Network topology in compose

- Internal/shared data-plane network:
  - `flux-v2-shared`
- Gateway-facing external network:
  - `flux-network` (external)

## 4) Notes/docs updates in this context

### Existing note included in commit scope

- `notes-for-justin/v2-gateway-testing-accomplishments-and-current-state.md`

This note captures:
- completed v2 gateway validation work
- known required shims prior to full engine-v2 integration
- k6 methodology and measured behavior
- immediate performance tuning direction

## 5) Validation performed

- Engine-v2 typecheck:
  - `pnpm exec tsc --noEmit` in `packages/engine-v2` passed.
- Gateway typecheck:
  - `pnpm exec tsc --noEmit` in `packages/gateway` passed.
- Compose validation:
  - `docker compose -f docker/v2-shared/docker-compose.yml config` passed using temporary env values.
- Lint diagnostics:
  - no linter errors reported in modified gateway/engine files.

## 6) Repo organization checklist (sync guide)

Use this quick map to stay organized:

- Engine v2 provisioning source:
  - `packages/engine-v2/src/index.ts`
- Shared short-id utility:
  - `packages/core/src/standalone.ts`
- Gateway hot-path caching/JWT:
  - `packages/gateway/src/tenant-resolver.ts`
  - `packages/gateway/src/cache.ts`
  - `packages/gateway/src/jwt-issuer.ts`
- Shared stack deployment:
  - `docker/v2-shared/docker-compose.yml`
- Session operational notes:
  - `notes-for-justin/v2-gateway-testing-accomplishments-and-current-state.md`
  - `notes-for-justin/2026-04-28-session-summary-engine-v2-gateway-and-v2-shared-compose.md` (this file)

