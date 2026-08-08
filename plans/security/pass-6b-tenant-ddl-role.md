# Pass 6b — tenant DDL/owner role (blocks v2_shared deploy)

**Status:** Merged (#6). **Production backfill applied 2026-08-08.** Dashboard deploy still pending.

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

| # | Item | Where | Status |
|---|------|-------|--------|
| 1 | Emit `t_<12hex>_ddl` role, schema ownership, and `FOR ROLE` default privileges in tenant bootstrap | `packages/engine-v2/src/index.ts` | done |
| 2 | Canonical name helper + validator for the DDL role | `packages/core/src/api-schema-strategy.ts` | done |
| 3 | Accept the DDL role in push session assertions; push runs as DDL role, not runtime role | `apps/dashboard/src/lib/pooled-push-session.ts` | done |
| 4 | Pass the derived DDL role through the push routes | `pooled-push-validators.ts`, `pooled-push-route.ts`, `app/api/cli/v1/push/route.ts` | done |
| 5 | Idempotent backfill script (create role, transfer schema + object ownership, default privileges) | `bin/pass6b-backfill-tenant-ddl-roles.sh` | done |
| 6 | Reconciliation query as a repeatable operator check | `bin/pass6b-reconcile-tenant-roles.sh` | done |
| 7 | Docs: app-facing note that DDL runs as an owner role distinct from the JWT role | `AGENTS.md`, `docs/pages/guides/migrations.md` | done |
| 8 | Post-push `FORCE ROW LEVEL SECURITY` + runtime-ownership assertion | `packages/core/src/tenant-rls-invariants.ts` | done |
| 9 | Real-Postgres integration test | `apps/dashboard/src/lib/pooled-push-privileges.integration.test.ts` | done |
| 10 | Run the production backfill | operator | done (2026-08-08) |
| 11 | **Deploy the dashboard carrying Pass 6 + 6b** | operator | **pending** |

---

## Deploy ordering (hard constraint)

1. Run the backfill against the shared cluster **first**, while the currently deployed
   (pre-Pass-6) control plane is still running. Backfill is compatible with it: the old
   executor runs as `postgres`, which is unaffected by ownership transfer.
2. Verify reconciliation reports every tenant with a DDL role owning its schema.
3. Only then deploy the dashboard carrying Pass 6 + Pass 6b.

Deploying the code first, or in the same step, reintroduces the push outage window.

```bash
export DOCKER_HOST=ssh://root@<flux-host>
export FLUX_SYSTEM_PG_CONTAINER=flux-<hash>-flux-system-db

./bin/pass6b-reconcile-tenant-roles.sh                       # before: DDLROLE = NO
./bin/pass6b-reconcile-tenant-roles.sh --backfill-set \
  | ./bin/pass6b-backfill-tenant-ddl-roles.sh
./bin/pass6b-reconcile-tenant-roles.sh                       # after: DDLROLE = yes, RT_OWNED = 0
```

Baseline captured 2026-08-08 (read-only): 27 schemas present, 19 catalog rows, 17 in the
backfill set, `DDLROLE = NO` everywhere, `RT_OWNED = 0` everywhere (no RLS-bypass drift
today), 226 RLS tables of which 4 are forced.

### Backfill result (applied 2026-08-08)

All 17 catalogued schemas: `DDLROLE = yes`, owner is `t_<id>_ddl`, `RT_OWNED = 0`,
`UNFORCED = 0`. The ten orphans are untouched and still owned by `postgres`.

Verified against the live cluster afterwards (all transactions rolled back):

- The **currently deployed pre-Pass-6 executor** still works — it runs as `postgres`, and a
  superuser can alter objects it does not own, so the ownership transfer is transparent to it.
- The **Pass 6b executor** works: `SET LOCAL ROLE t_<id>_ddl` + `CREATE TABLE` succeeds. This
  is the exact statement that failed with `permission denied for schema` during preflight.
- **RLS still filters correctly** for the runtime role: a live tenant table returned 1 row with
  the matching `sub` claim and 0 without. Forcing RLS changed nothing for serving traffic,
  because the runtime role was already a non-owner — `FORCE` only constrains the owner.

### Consequence to watch after deploy

With `FORCE ROW LEVEL SECURITY` applied, the DDL role is itself subject to policy on those
tables. A migration or repeatable script that seeds rows into an RLS-protected table will
now be filtered unless a policy permits the insert — previously it ran as `postgres` and
bypassed RLS. Seed scripts that break this way should either gain an appropriate policy or
use the documented `flux:no-force-rls` exemption.

---

## Resolved decisions (operator, 2026-08-08)

### Orphan schemas: classified, then excluded

All ten uncatalogued schemas were classified read-only before deciding. Nine contain zero
tables, views, and sequences. The tenth, `t_b86da057199a_api`, holds two tables
(`products`, `profiles`) with **zero live rows, zero lifetime writes, and no autovacuum
history** — an abandoned provisioning attempt that duplicates the table shape of the live
`t_485382535699_api` (bloom-atelier).

None qualify as live or intentionally retained, so **none are backfilled**. They are left
untouched pending a separate cleanup decision. Dead infrastructure does not get a
privilege model.

The backfill set is therefore the **17 schemas that have a catalog row**, derived from the
catalog rather than from the cluster, so an orphan can never enter it by accident:

```
./bin/pass6b-reconcile-tenant-roles.sh --backfill-set | ./bin/pass6b-backfill-tenant-ddl-roles.sh
```

Sixteen are `v2_shared`. The seventeenth, `t_485382535699_api` (bloom-atelier), is a
`v1_dedicated` project with a live tenant schema on the shared cluster; pooled push never
targets it today, but it is retained and carries real data, so it is backfilled for
consistency rather than left in a third state.

### FORCE ROW LEVEL SECURITY: scoped, not blanket

Applied to tables that **already have RLS enabled** and are missing `FORCE`. Tables without
RLS are untouched — forcing them would change behavior the tenant never asked for.

Documented exemption: a table whose comment contains `flux:no-force-rls` is skipped, for
deliberately owner-readable tables.

```sql
COMMENT ON TABLE t_<id>_api.audit_log IS 'flux:no-force-rls — append-only, read via view';
```

This runs post-push (after `RESET ROLE`, inside the same transaction) and also during
backfill. Production currently has 226 RLS-enabled tenant tables, of which only 4 are
forced, so the first push per tenant will force the rest.

### Ownership assertion

Every push also asserts, in-transaction, that the runtime role owns nothing in the tenant
schema, and rolls back if it does. This catches ownership drift at the moment it would
start bypassing RLS instead of at the next audit.

---

## Verification

`apps/dashboard/src/lib/pooled-push-privileges.integration.test.ts` runs against a real
cluster (opt-in: `FLUX_RUN_PG_INTEGRATION=1` + `FLUX_TEST_POSTGRES_URL`). Privilege limits
are asserted through an **`authenticator` login connection**, mirroring PostgREST — a
superuser session can `SET ROLE` to anything and bypasses RLS, so asserting them from the
control-plane connection would prove nothing.

All ten sub-assertions pass, including the Pass 6 regression itself (a migration can create
a table), plus: pushed tables are owned by the DDL role; RLS is enabled *and* forced; the
runtime role cannot create, alter, drop, or `SET ROLE` to the DDL role; RLS still filters
rows; cross-tenant DDL fails; a failed push leaves no artifacts; and a push aborts if the
runtime role owns a tenant object.

The backfill was rehearsed against a legacy-shaped tenant (schema and tables owned by
`postgres`, runtime role present, no DDL role): ownership transferred, RLS forced, the
script is idempotent across repeated runs, and a subsequent push succeeded.

### Follow-up found by the live smoke (2026-08-08, post-deploy)

The integration test builds its own policies and never referenced `auth.uid()`, so it
missed this: the DDL role had no `USAGE` on schema `auth`. Bootstrap granted it to the
runtime role only, and before Pass 6 push ran as a superuser, which needs no grant. The
first real migration through the deployed control plane failed with
**`permission denied for schema auth`** on

```sql
CREATE POLICY … USING (owner_sub = auth.uid());
```

That is the pattern `docs/pages/guides/authjs.md` and `clerk.md` teach, and the Supabase
import path depends on it, so it blocked the documented onboarding flow. No *existing*
tenant policy was affected — zero of 1,110 production policies reference `auth.uid()`,
and serving traffic evaluates policies as the runtime role, which always had the grant.

Bootstrap and the backfill script now grant `USAGE ON SCHEMA auth` to the DDL role, the
reconcile script reports it as `AUTHUSG`, and a unit test covers it. Same root cause as
Pass 6 itself: the privilege model was not fully re-derived for the new executing identity.

### Fixed along the way

`buildDeprovisionSql` could never drop a tenant: `DROP ROLE` failed with *"role … cannot be
dropped because some objects depend on it — privileges for schema auth"*, because
provisioning grants the runtime role `USAGE ON SCHEMA auth`. Deprovision now issues
`DROP OWNED BY` for both roles first. Pre-existing bug, surfaced by the integration test's
teardown.

---

## Still open (not blocking)

- `public` on the shared cluster carries four leftover debug helpers (`_debug_cu`,
  `_debug_jwt_role`, `_test_set_config`, `flux_ctx_debug`) alongside the two PostgREST hook
  functions. Unrelated to this pass; worth a separate cleanup.
- The ten orphaned schemas need a drop/retain decision.
