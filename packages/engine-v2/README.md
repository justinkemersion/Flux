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

See [`docs/pages/architecture/flux-v2-architecture.md`](../../docs/pages/architecture/flux-v2-architecture.md):

- §6 — Internal architecture (engine abstraction, control plane vs data plane)
- §4 — Tenant isolation (deterministic schema and role names from `tenant_id`)
- §7 — Operational behavior (per-role `statement_timeout` and `CONNECTION LIMIT`)
- §3 — Authentication flow and Reference → Invariants (`PGRST_DB_SCHEMAS` policy is invariant 6)
