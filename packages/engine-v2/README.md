# @flux/engine-v2

**Execution profile:** `v2_shared`

Shared-cluster execution strategy for Flux: one PostgreSQL schema per tenant
(`t_<shortid>_api`), one role per tenant (`t_<shortid>_role`), pooled PostgREST, PgBouncer
in transaction mode.

## Current status

**Placeholder package.** Implementation begins once the engine interface in `@flux/core` is
locked and the gateway package provides runtime JWT issuance.

## Naming convention

```
tenant_id  UUID v4 (immutable, source of truth)
shortid    first 12 hex chars of tenant_id with hyphens removed
schema     t_<shortid>_api
role       t_<shortid>_role
```

## Architecture reference

See [`docs/flux-v2-architecture.md`](../../docs/flux-v2-architecture.md):

- §9 — Engine abstraction (v2-only methods)
- §10 — Tenant naming and identity
- §14 — DB guardrails (`statement_timeout`, `CONNECTION LIMIT`)
- §8 — PostgREST behavior and PGRST_DB_SCHEMAS policy
