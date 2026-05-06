---
title: Request flow
description: End-to-end lifecycle of one HTTP request on v2 shared vs v1 dedicated.
---

# Request flow

Understanding request flow prevents mixing concerns: TLS/SNI, tenant resolution, JWT verification, PostgREST routing, and Postgres permissions are **different** failure modes.

## What you will learn

- v2 shared path step-by-step
- How v1 differs
- Where to look first when debugging

## The idea

### v2 shared

```txt
HTTPS client
  → Traefik / edge (TLS)
  → Flux gateway (host → tenant, verify project JWT)
  → PostgREST pool (bridge JWT → role)
  → Postgres (tenant schema, policies)
```

### v1 dedicated (typical)

```txt
HTTPS client
  → Traefik (host → tenant API container)
  → PostgREST (project keys / JWT per container env)
  → Postgres (per-project instance)
```

## How it works

Empty arrays usually mean filters or RLS—not “gateway off”. **401** before Postgres indicates auth at edge. **`42501`** indicates database authorization.

## Example

For internal health checks from `flux-web`, prefer probing via the **gateway** with correct `Host` headers—see `README.md` (`FLUX_TENANT_PROBE_GATEWAY_URL`).

## Next steps

- [Mental model](/docs/introduction/mental-model)
- [First request](/docs/getting-started/first-request)
