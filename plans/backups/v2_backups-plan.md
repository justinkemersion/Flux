Let's move forward with the v2 export layer, not full v2 disaster recovery yet.

What we should consider to do next:

v1_dedicated backups: operational trust
v2_shared backups: tenant portability

For v2, build:

flux backup create -p <v2-project>
flux backup verify --latest
flux backup download --latest

But internally it should dump only:

t_<shortid>_api

Not the whole shared DB.

v2 backup MVP scope

Support:

schema-only tenant export
data-only tenant export
full tenant export

Probably default:

pg_dump -Fc \
  --schema=t_<shortid>_api \
  --no-owner \
  --no-acl

And verify with disposable Postgres:

pg_restore into empty DB
confirm tenant schema exists
confirm non-system tables exist
What not to do yet

Do not start with:

shared cluster PITR
WAL archiving
per-tenant point-in-time restore
cross-project restore UI

That is later.

Important v2 nuance

A v2 backup is not quite the same promise as v1.

For v1:

This can restore the project database.

For v2:

This can restore/export the tenant API schema.

So I’d label it clearly:

Tenant export backup

or:

Portable tenant backup

This keeps the trust boundary honest.

My recommendation

Do v2 next, but with precise language:

v2_shared supports portable tenant backups.
Flux internal shared-cluster recovery remains a platform-level operation.

That’s the right next milestone in my opinion.

---

## Implementation notes (2026)

Shipped in-repo:

- **`project_backups.kind`**: `project_db` | `tenant_export` (Drizzle + bootstrap SQL in `apps/dashboard/src/lib/db/index.ts`).
- **v2 dump:** `pg_dump -Fc --schema=t_<shortId>_api --no-owner --no-acl` via `FLUX_SHARED_POSTGRES_URL` (`apps/dashboard/src/lib/tenant-backup-stream.ts`).
- **MVP scope:** full tenant-schema export only (no separate CLI flags for schema-only vs data-only yet).
- **Scheduler:** nightly backups remain **v1_dedicated** only (`backup-scheduler.ts`); v2 is on-demand.
- **Smoke:** optional `bin/e2e-v2-tenant-backup-smoke.sh` (needs `FLUX_API_*` + slug/hash).
