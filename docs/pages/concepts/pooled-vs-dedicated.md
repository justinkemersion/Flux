---
title: Pooled vs dedicated
description: v2 shared versus v1 dedicated—operational and security tradeoffs in plain language.
---

# Pooled vs dedicated

**v2 shared** (**pooled**) runs many tenants on shared Postgres / PostgREST infrastructure with **schema- and role-level** isolation and a **gateway** at the edge. **v1 dedicated** provisions **per-project** Postgres and PostgREST containers for stronger physical separation.

## What you will learn

- Isolation boundaries for each engine
- Blast radius differences
- How to choose honestly

## The idea

Pooled infrastructure is real Postgres—not a simulation—but accepts **cluster-level** blast radius: a misbehaving tenant can stress shared resources. Dedicated stacks trade cost and container count for cleaner separation.

Marketing tiers map to engines, but docs should use **engine** / **deployment model** language when being precise.

## How it works

| Aspect | v2 shared | v1 dedicated |
|--------|-----------|----------------|
| Postgres | Shared cluster, tenant schemas | Container per project |
| PostgREST | Pooled behind gateway | Usually per project |
| Public edge | Flux gateway validates JWTs | Traefik → tenant API |
| Isolation | Schema + role + gateway correctness | Physical + network separation |

## Example

Choose **dedicated** when policy or risk requires no shared database cluster. Choose **shared** when efficiency and operational simplicity outweigh that requirement.

## Next steps

- [Flux v2](/docs/architecture/flux-v2)
- [Pooled → dedicated migrate](/docs/guides/v2-to-v1-migrate)
- [Tenant isolation (security)](/docs/security/tenant-isolation)
