---
title: Tenant isolation (architecture)
description: Structural boundaries—schemas, roles, networks, and containers—for v1 and v2.
section: architecture
---

# Tenant isolation (architecture)

This page describes **how isolation is constructed**. For guarantees under threat, read [Tenant isolation (security)](/docs/security/tenant-isolation).

## What you will learn

- v2: schema + role + gateway path
- v1: per-project containers and networks
- Where secrets and URLs fit structurally

## The idea

**v2 shared** isolates tenants logically:

- Deterministic **tenant schemas** (`t_<shortId>_api`, …)
- **Roles** with usage limited to their schema
- **Gateway** chooses tenant from host and mints role-scoped bridge JWTs

**v1 dedicated** adds physical separation: dedicated Postgres and PostgREST, private docker networks, Traefik routes to a specific API container.

## How it works

| Layer | v2 shared | v1 dedicated |
|-------|-----------|----------------|
| Network | Shared pool networks + gateway | Per-tenant private net + `flux-network` for edge |
| DB | Shared cluster | Container per project |
| API | Shared PostgREST pool | Container per project |
| Edge | Gateway | Traefik labels on API |

## Example

Schema names are **not** derived from marketing slugs—do not encode slug into migration files; discover names from the platform.

## Next steps

- [Tenant isolation (security)](/docs/security/tenant-isolation)
- [Flux v2 shared](/docs/architecture/flux-v2)
