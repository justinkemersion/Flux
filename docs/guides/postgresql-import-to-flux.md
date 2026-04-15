# Importing PostgreSQL data into Flux

Flux tenants run a **pinned Postgres image** (see `FLUX_DOCKER_IMAGES.postgres` in `@flux/core`). Imports must match that major version and the way Flux wires **PostgREST** (`api` schema, `anon` / `authenticated` roles).

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

- Reference **`auth.users`** and use **`auth.uid()`** in RLS policies. Plain Postgres has no `auth` schema unless you add it.
- Omit `auth` data if you dumped only `public`.

Use:

```bash
flux db-reset -p myproject --yes
flux push ./dump.sql -p myproject --supabase-compat
```

`--supabase-compat` inserts a minimal `auth` schema, `auth.users`, `auth.uid()` (JWT `sub` via PostgREST’s `request.jwt.claim.sub`), and seeds `auth.users` before the standard `batches_user_id_fkey → auth.users` block. If your dump layout differs, adjust manually or extend `applySupabaseCompatibilityTransforms` in `@flux/core`.

## Flags

| Command | Meaning |
|--------|---------|
| `flux push --no-sanitize` | Do not strip unsupported `SET` lines (for exotic targets or debugging). |
| `flux push --supabase-compat` | Apply Supabase-oriented auth stubs and seed (see above). |

## API (`@flux/core`)

- `preparePlainSqlDumpForFlux`, `sanitizePlainSqlDumpForPostgresMajor`, `applySupabaseCompatibilityTransforms` — build tooling or tests.  
- `ProjectManager.importSqlFile(path, { supabaseCompat, sanitizeForTarget, targetMajor })` — runs **`psql -f`** via host `psql` when available, otherwise `docker cp` + `docker exec psql -f` (avoids Docker Engine attach stdin, which can hang).  
- `ProjectManager.resetTenantDatabaseForImport(name)` — same work as `flux db-reset`.
