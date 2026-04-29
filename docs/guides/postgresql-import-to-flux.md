# Importing PostgreSQL data into Flux

Flux tenants run a **pinned Postgres image** (see `FLUX_DOCKER_IMAGES.postgres` in `@flux/core`). Imports must match that major version and the way Flux wires **PostgREST** (`api` schema, `anon` / `authenticated` roles).

## Start here (choose your path)

- **Brand-new app on pooled Flux (`v2_shared`)**: use [`docs/guides/flux-nextjs-v2-shared-quickstart.md`](./flux-nextjs-v2-shared-quickstart.md), then extend with [`docs/guides/flux-nextjs-authjs-rls.md`](./flux-nextjs-authjs-rls.md).
- **Existing app / database port**: continue with this guide for dump import, compatibility transforms, and `public` → `api` migration details.

## Universal issues (any source → Flux)

1. **Server version mismatch**  
   `pg_dump` from PostgreSQL 17+ often emits `SET transaction_timeout = 0;` and other settings that **do not exist on PostgreSQL 16**. Those statements fail under `ON_ERROR_STOP`.  
   **Default:** `flux push` strips known unsupported session `SET` lines for the **tenant server’s major version** (query via `server_version_num`).

2. **Silent partial applies**  
   Without `ON_ERROR_STOP`, `psql` can continue after errors and exit 0. Flux `push` runs `psql` with **`ON_ERROR_STOP=1`** so the first error fails the command and surfaces stderr.

3. **Clean slate vs layered imports**  
   Re-running a full schema dump on top of a **partially imported** database leaves inconsistent objects. For a full plain-text dump you usually want either:
   - **`flux db-reset -p <project> --yes`** — drops `public` and `auth`, recreates `public`, reapplies Flux bootstrap SQL (no Docker volume delete), then **`flux push`**; or  
   - **`flux nuke -y <name>`** then **`flux create <name>`** — destroys the volume and reprovisions an empty cluster.

4. **Extensions**  
   Dumps that rely on extensions (PostGIS, `uuid-ossp`, etc.) need those extensions **installed in the tenant** (`CREATE EXTENSION` in the dump or a manual step). `db-reset` does not install extensions.

5. **Where tables live vs PostgREST**  
   Flux defaults PostgREST to the **`api`** schema. Many dumps place app tables in **`public`**. You may need views in `api`, a migration to move objects, or a PostgREST config change — that is an app design concern, not handled by `push` alone.

## Supabase → Flux

Supabase dumps commonly:

- Reference **`auth.users`** and use **`auth.uid()`** in RLS policies. Plain Postgres has no `auth` schema unless you add it. Flux bootstrap already defines **`auth.uid()`** returning **`text`** (JWT `sub` from **`request.jwt.claims`**), so policies can use **`auth.uid()`** like Supabase while supporting Clerk / NextAuth string IDs.
- Omit `auth` data if you dumped only `public`.

Use:

```bash
flux db-reset -p myproject --yes
flux push ./dump.sql -p myproject --supabase-compat
# or: flux push ./dump.sql -p myproject -s
```

`--supabase-compat` (`-s`) turns on **Supabase compatibility**: dump transforms (minimal `auth` schema, `auth.users`, `auth.uid()` as **text**, seed before `auth.users` FKs), then **moves** tables, sequences, views, and materialized views from `public` into `api`, and reapplies grants on `api`. A short **post-migration report** lists how many objects moved. If your dump layout differs, adjust manually or extend `applySupabaseCompatibilityTransforms` in `@flux/core`.

For **profiles** auto-provisioning without Supabase Auth triggers, see **Profiles row on first use** in [`docs/guides/clerk-integration.md`](clerk-integration.md) (RPC or trigger templates).

### Supabase JS `createClient` (schema)

Flux PostgREST is configured for tenant data in the **`api`** schema (first in `PGRST_DB_SCHEMAS`). `@supabase/supabase-js` defaults to **`public`**, so the client must select `api` or requests miss tables / return empty errors.

In the app (for example `lib/supabase.ts`):

```ts
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    db: {
      schema: "api",
    },
  },
);
```

Point `NEXT_PUBLIC_SUPABASE_URL` at the Flux tenant API URL (no `/rest/v1` suffix on the env value; the client adds that path). Use the **anon key** from the Flux dashboard or CLI so JWTs match `PGRST_JWT_SECRET` on the PostgREST container.

## Flags

| Command | Meaning |
|--------|---------|
| `flux push --no-sanitize` | Do not strip unsupported `SET` lines (for exotic targets or debugging). |
| `flux push --supabase-compat` | Apply Supabase-oriented auth stubs and seed (see above). |

## API (`@flux/core`)

- `preparePlainSqlDumpForFlux`, `sanitizePlainSqlDumpForPostgresMajor`, `applySupabaseCompatibilityTransforms` — build tooling or tests.  
- `ProjectManager.importSqlFile(path, { supabaseCompat, moveFromPublic, sanitizeForTarget, targetMajor })` — uploads the SQL into the tenant Postgres container and runs **`psql -f`** there via the Docker API (no host TCP to Postgres; works with remote daemons). With `moveFromPublic: true`, runs the schema mover (`public` → `api`) and returns `ImportSqlFileResult` counts.  
- `ProjectManager.resetTenantDatabaseForImport(name)` — same work as `flux db-reset`.
