---
title: Gateway
description: The Flux gateway as authentication and routing boundary for v2 shared traffic.
section: architecture
---

# Gateway

The **Flux gateway** is the public ingress for **v2 shared** Service URLs. It resolves the hostname to a **tenant**, validates the caller’s **project JWT**, and issues a short-lived **bridge JWT** consumed by PostgREST.

## What you will learn

- Why “proxy” understates the gateway
- What verification implies for trust
- Relationship to rate limiting and Redis (cache-only)

## The idea

The gateway is a **security control**, not passive forwarding. A mistaken `tenant_id` or `role` in an issued JWT is a **cross-tenant data risk**; mitigations include strict resolution against the catalog, short TTLs, and tests around host parsing.

Redis (when used) is for cache and telemetry—**not authoritative** for correctness.

## How it works

At a high level:

1. TLS terminates (or upstream proxy terminates) on the public name.
2. Gateway maps host → tenant record.
3. External JWT verified per project configuration.
4. Bridge JWT minted with Postgres role and claims PostgREST expects.

Internal probes may use **`FLUX_TENANT_PROBE_GATEWAY_URL`** to avoid relying on public DNS from inside containers—see [Environment variables](/docs/reference/env-vars).

## Example

Debugging production traffic often starts at gateway logs (reject reasons) before Postgres logs—401s usually never reach the database.

## Next steps

- [Bridge JWTs](/docs/architecture/bridge-jwts)
- [Authentication model](/docs/security/authentication-model)
