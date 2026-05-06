---
title: Flux v2 shared
description: Shared cluster architecture, invariants, and why the gateway is a security control.
---

# Flux v2 shared

Flux **v2** runs many tenants on a **shared PostgreSQL cluster** and **PostgREST pool** while keeping logical isolation at the **schema** and **database role** level. A **Node gateway** is the public ingress: it resolves the host to a tenant, validates external JWTs, and mints **bridge JWTs** for PostgREST.

## What you will learn

- Hard invariants (from `docs/flux-v2-architecture.md`)
- Soft isolation tradeoffs on Free/Pro
- Why gateway correctness is critical

## The idea

v2 exists to reduce container sprawl and memory overhead versus **v1 dedicated**. It does **not** remove Postgres or PostgREST from the picture—it changes how they are shared.

Authoritative spec (in this repository): `docs/flux-v2-architecture.md`.

### Invariants (summary)

- `tenant_id` is immutable; slug is UI-only.
- Schema/role names derive from `tenant_id` via a deterministic short id—**slug is never embedded** in schema identifiers.
- **Only the gateway** issues runtime JWTs for tenant API traffic (for this path).
- **PostgREST is not publicly reachable** without passing gateway controls in the target topology.
- Do not enumerate all tenant schemas in `PGRST_DB_SCHEMAS`; access is via grants + `search_path` + JWT role.

## How it works

```txt
Client → Service URL → Gateway → Bridge JWT → PostgREST pool → tenant schema
```

Operational controls (rate limits, connection limits, timeouts) mitigate noisy neighbors but do not create dedicated hardware isolation.

## Example

When you see connection spikes on the shared cluster, you scale or split clusters operationally—product docs should not promise per-tenant CPU pinning on the pooled tier unless explicitly offered.

## Next steps

- [Gateway](/docs/architecture/gateway)
- [Threat model](/docs/security/threat-model)
