# @flux/gateway

Flux request gateway: resolve → rate-limit → sign JWT → proxy to PostgREST.

## Current status

Implemented Node gateway request path with:

- hostname -> tenant resolution (memory + Redis + DB fallback)
- mode gating (`v2_shared` only)
- per-tenant rate limiting and inflight load shedding
- runtime JWT minting with local reuse cache
- streamed proxying to pooled PostgREST with upstream timeout handling
- best-effort activity tracking and structured request logging
- pre-tenant **static-asset / scanner absorber** so `/robots.txt`,
  `/favicon.ico`, `/.well-known/*`, `/wp-admin`, `/bot-connect.js`, and
  similar browser-default and security-probe traffic never reach the DB
  (see [`src/static-asset-filter.ts`](src/static-asset-filter.ts))
- optional pre-tenant **bot User-Agent denylist** (off by default,
  controlled by `FLUX_GATEWAY_BLOCK_BOT_USER_AGENTS`; see
  [`src/bot-filter.ts`](src/bot-filter.ts))

## Contracts

1. **Sole upstream JWT issuer** — gateway is the only service that mints short-lived pool-signed
   runtime JWTs (`{ role, tenant_id, exp }`) for PostgREST. Optional: clients may send Bearer tokens
   signed with the per-project `jwt_secret`; the gateway verifies those before proxying.
2. **PostgREST is private** — gateway is the only upstream for PostgREST; it must never be
   exposed to the public internet.
3. **Redis is best-effort** — all Redis calls (`rate:*`, `activity:*`, `hostname:*`) must be
   wrapped in `try/catch`. Redis errors must not abort a proxied request (fail-open).
4. **429 on rate limit** — return HTTP 429 and do not forward when `rate:{tenant_id}` exceeds
   the tier limit.
5. **No persistence** — gateway reads `flux-system` but never writes to it.

## Architecture reference

See [`docs/flux-v2-architecture.md`](../../docs/flux-v2-architecture.md):

- §6 — Gateway responsibility boundary
- §7 — JWT contract
- §11 — Redis and rate limiting
- §12 — Custom domain resolution and cache eviction

### Schema-routing handshake (informational)

When tenant logs show a query plan with `WITH pgrst_source AS (SELECT
"t_<shortid>_api"."…" …)`, that is **proof the schema isolation handshake is
working**, not a bug. The gateway injects `Accept-Profile` (GET/HEAD) and
`Content-Profile` (POST/PATCH/PUT/DELETE) headers in
[`src/proxy.ts`](src/proxy.ts) using
`defaultTenantApiSchemaFromProjectId(tenantId)`; PostgREST v12 then resolves
all references through the tenant's `t_<shortid>_api` schema. The catalogue's
`pgrst_source` CTE is the visible side-effect of that resolution.

### Request flow

```
incoming request
  ├─ /health, /health/deep                        → liveness/readiness response
  ├─ /robots.txt, /favicon.ico, /apple-touch-icon → static-asset absorber
  │  /.well-known/*, /wp-admin, /.env, …             (no DB, no PostgREST)
  ├─ User-Agent matches bot denylist (opt-in)     → 403 forbidden
  │                                                  (no DB, no PostgREST)
  └─ everything else                              → resolveTenant → mint JWT
                                                       → proxy to pool
```
