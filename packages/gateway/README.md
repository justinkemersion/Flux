# @flux/gateway

Flux request gateway: resolve → rate-limit → sign JWT → proxy to PostgREST.

## Current status

**Placeholder package.** Implementation tracked separately; this package establishes the
workspace boundary and documents the contracts that the gateway implementation must satisfy.

## Contracts

1. **Sole JWT issuer** — gateway is the only service that mints runtime JWTs for tenant API
   traffic. No other package may issue `{ role, tenant_id, exp }` tokens for production traffic.
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
