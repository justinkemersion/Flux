# Pass 6b — tenant DDL/owner role (blocks v2_shared deploy)

**Status:** Planned — not implemented. **Pass 6 must not be deployed to v2_shared production until this lands.**

Pass 6 (PR #2, merged as `d995291`) made pooled push execute user SQL under
`SET LOCAL ROLE t_<12hex>_role`. Production preflight on 2026-08-08 showed that role
cannot create objects in its own schema, so the merged code breaks every v2_shared
migration push. This pass supplies the missing privilege model without reintroducing
the control-plane role and without breaking RLS.

---

## Production evidence (2026-08-08, read-only preflight)

Catalog (`flux-5y57e70-flux-system-db`) and shared cluster (`flux-postgres-v2`) on the
Hetzner host, `vsl-cloud` Docker context.

| Observation | Value |
|---|---|
| v2_shared projects | 16 (15 active, 1 archived) |
| Rows with explicit `api_schema_name` | 2 — `static`, `yeastcoast` |
| Explicit vs canonical derived name | 0 mismatches |
| Expected tenant schemas present | 16 / 16 |
| Expected tenant roles present | 16 / 16 |
| Tenant schemas where the tenant role has `CREATE` | **0 / 27** |
| Tenant tables | 229, all owned by `postgres` |
| Tenant tables with RLS enabled | 226 |
| Tenant tables with `FORCE ROW LEVEL SECURITY` | **4** |

Reproduced directly (transaction rolled back, nothing persisted):

```sql
BEGIN;
SET LOCAL ROLE t_5b7f3d8926c7_role;
SET LOCAL search_path TO t_5b7f3d8926c7_api;
CREATE TABLE flux_preflight_probe (id int);
-- ERROR:  permission denied for schema t_5b7f3d8926c7_api
ROLLBACK;
```

Provisioning (`packages/engine-v2/src/index.ts`) grants the tenant role `USAGE` on the
schema and `SELECT` on tables, never `CREATE`. Schemas are created without an
`AUTHORIZATION` clause, so `postgres` owns them.

---

## Why the obvious fix is wrong

Granting `CREATE` to `t_<12hex>_role`, or making it the schema owner, makes newly pushed
tables owned by that role. That is the **same role PostgREST assumes at runtime** via the
bridge JWT, and in Postgres a table owner bypasses RLS unless the table carries
`FORCE ROW LEVEL SECURITY`. With 226 RLS-enabled tables and only 4 forced, this would
silently disable row filtering for the tenant's own runtime role — cross-user reads
inside a tenant, with no error surfaced.

**Invariant to preserve: the identity that runs DDL must never be the identity PostgREST
assumes at runtime.**

---

## Design

Introduce a per-tenant owner/DDL role, `t_<12hex>_ddl`:

- `NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE`.
- Owns the tenant schema (`ALTER SCHEMA … OWNER TO`), which confers `CREATE` without a
  separate grant.
- **Never** granted to `authenticator`, and no JWT role claim may resolve to it. This is
  what keeps the runtime role a non-owner so RLS continues to apply.
- Control plane connects as `postgres` (verified), so `SET LOCAL ROLE t_<id>_ddl`
  works without membership. Add an explicit `GRANT t_<id>_ddl TO postgres` anyway so the
  model still holds if the control plane is de-privileged later.

Default privileges must be attached to the DDL role, because the existing
`ALTER DEFAULT PRIVILEGES` statements in provisioning default to `FOR ROLE current_user`
(`postgres`) and will not fire for objects created by the DDL role:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE t_<id>_ddl IN SCHEMA t_<id>_api
  GRANT SELECT ON TABLES TO t_<id>_role, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE t_<id>_ddl IN SCHEMA t_<id>_api
  GRANT USAGE, SELECT ON SEQUENCES TO t_<id>_role;
```

Tenant migrations keep granting their own write privileges to `t_<id>_role`
(`GRANT INSERT, UPDATE, DELETE …`), which is the documented app contract and is what
PR #5's `adaptPooledPushSql` rewrites `authenticated` into. That contract is unchanged.

### Existing object ownership

Mixed ownership breaks `ALTER TABLE` from the DDL role, so the 229 existing tables (plus
sequences, views, functions) must be reassigned per tenant schema. Scope the reassignment
to the tenant schema — do **not** use bare `REASSIGN OWNED BY`, which is cluster-wide for
the role and would sweep unrelated objects.

---

## Work items

| # | Item | Where |
|---|------|-------|
| 1 | Emit `t_<12hex>_ddl` role, schema ownership, and `FOR ROLE` default privileges in tenant bootstrap | `packages/engine-v2/src/index.ts` |
| 2 | Canonical name helper + validator for the DDL role | `packages/core/src/api-schema-strategy.ts` |
| 3 | Accept the DDL role in push session assertions; push runs as DDL role, not runtime role | `apps/dashboard/src/lib/pooled-push-session.ts` |
| 4 | Pass the derived DDL role through the push routes | `apps/dashboard/app/api/cli/v1/push/route.ts` |
| 5 | Idempotent backfill script for the 16 existing tenants (create role, transfer schema + object ownership, default privileges) | `bin/` |
| 6 | Reconciliation query as a repeatable operator check | `bin/` |
| 7 | Docs: app-facing note that DDL runs as an owner role distinct from the JWT role | `AGENTS.md`, `docs/pages/guides/migrations.md` |

Tests must include a case proving the runtime role is **not** the owner of objects created
by a push, since that is the property preventing the RLS bypass. The current pooled-push
tests use a fake client that cannot catch privilege errors, so at least one integration-style
check against a real Postgres is needed before deploy.

---

## Deploy ordering (hard constraint)

1. Run the backfill against the shared cluster **first**, while the currently deployed
   (pre-Pass-6) control plane is still running. Backfill is compatible with it: the old
   executor runs as `postgres`, which is unaffected by ownership transfer.
2. Verify reconciliation reports every tenant with a DDL role owning its schema.
3. Only then deploy the dashboard carrying Pass 6 + Pass 6b.

Deploying the code first, or in the same step, reintroduces the push outage window.

---

## Open questions for the operator

- Ten tenant schemas on the cluster have no catalog row. Backfill them too, or leave them
  untouched and clean up separately? They are not reachable through the control plane.
- `public` on the shared cluster carries four leftover debug helpers (`_debug_cu`,
  `_debug_jwt_role`, `_test_set_config`, `flux_ctx_debug`) alongside the two PostgREST
  hook functions. Unrelated to this pass; worth a separate cleanup.
- Should Pass 6b also set `FORCE ROW LEVEL SECURITY` on tenant tables as defence in depth?
  Not required once the owner is distinct from the runtime role, but it would make the
  guarantee independent of future ownership drift.
