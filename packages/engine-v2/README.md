# @flux/engine-v2

**Execution profile:** `v2_shared`

Shared-cluster execution strategy for Flux: one PostgreSQL schema per tenant
(`t_<shortid>_api`), one role per tenant (`t_<shortid>_role`), pooled PostgREST, PgBouncer
in transaction mode.

## Current status

Implemented bootstrap path for shared-cluster tenant provisioning:

- derive `shortid` from `tenant_id` using shared standalone utility
- create/ensure tenant schema + role (`t_<shortid>_api`, `t_<shortid>_role`)
- apply role guardrails (`statement_timeout`, `CONNECTION LIMIT`)
- grant schema usage and role inheritance to `authenticator`
- execute against shared cluster via `FLUX_SHARED_POSTGRES_URL`

JWT issuance remains in `@flux/gateway`; this package only handles Postgres-side setup.

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
