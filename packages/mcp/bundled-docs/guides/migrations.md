---
title: Migrations workflow
description: Practical workflow for SQL migrations, tenant schemas, and flux push.
section: guides
---

# Migrations workflow

Treat SQL files in Git as **canonical**. `flux push` applies them to the tenant database and triggers PostgREST reload.

## What you will learn

- Why schema naming matters on v2
- Idempotency habits
- How to validate after push

## The idea

On **v2 shared**, create objects in your **`t_<shortId>_api`** schema (name from the platform—not the marketing slug). Creating only in `public` often yields permission errors at request time.

To move an entire project from **v2 shared** to **v1 dedicated** (engine change, not a SQL file), use **`flux migrate`**—see [Pooled → dedicated migrate](/docs/guides/v2-to-v1-migrate).

After push, wait briefly for reload before assuming new tables exist in PostgREST’s cache.

## How it works

Every push must resolve a project. From your machine, pass **`--project`** and **`--hash`** from **`flux list`** (example values—use yours), or put **`slug`** and **`hash`** in repo-root **`flux.json`**. If **`flux.json`** still has **`REPLACE_AFTER_FLUX_INIT`**, run **`flux init`** first (not manual hash edits).

### Golden rule

**Do not edit a migration after it has been applied. Create a new migration instead.**

Flux stores a SHA-256 checksum per file in **`flux.flux_migrations`** (in the reserved **`flux`** schema, outside PostgREST). If you change an applied file, the next push reports a **checksum conflict** and refuses to run.

### Ordered directory migrations (recommended)

Keep numbered SQL files in **`migrations/`** (or **`flux/migrations/`**). Flux applies them **in lexicographic order**, skips files already recorded in the tenant ledger, and stops on checksum drift if an applied file was edited later.

```bash
flux push migrations/ --project percept --hash b915ec8
# or, when flux.json is present:
flux push migrations/
```

With no argument, Flux looks for **`migrations/`**, then **`flux/migrations/`**, then **`sql/`**, then **`schema.sql`**.

Example output:

```text
Flux migrations
✓ 001_init.sql already applied
→ 002_indexes.sql applying...
✓ 002_indexes.sql applied
Done. 1 applied, 1 skipped.
```

Lines are always shown in **filename order** (the migration timeline), not grouped by status.

### Versioned migrations

Versioned migrations are immutable schema changes. They run once and are recorded in the migration ledger. If a previously applied migration changes checksum, Flux refuses to run it again.

Directory pushes are always versioned. Single files under **`migrations/`**, **`flux/migrations/`**, or **`sql/migrations/`** default to versioned mode as well.

```bash
flux push migrations/0001_profiles.sql
flux push migrations/0001_profiles.sql --mode versioned
```

### Repeatable scripts

Repeatable scripts are for desired-state or idempotent SQL such as views, functions, reference data, and public demo seeds. Flux records their checksum in **`flux.flux_repeatable_scripts`** and re-runs them when the checksum changes. Use **`--force`** to run an unchanged repeatable script again.

Repeatable scripts use the same project credentials, tenant schema search path, transaction handling, and auth model as normal migrations. Flux does not bypass destructive-operation backup gates on push—follow [Backups workflow](/docs/guides/backups) before irreversible SQL.

```bash
flux push flux/scripts/seed_demo_users.sql --mode repeatable
flux push flux/scripts/seed_demo_users.sql --mode repeatable --force
```

By default, repeatable **`script_id`** is the repo-relative path (e.g. `flux/scripts/seed_demo_users.sql`). Override with **`--id`** when you need a stable identity independent of path.

### Single-file push modes

| Mode | When | Ledger |
|------|------|--------|
| **raw** (default outside `migrations/`) | Ad-hoc SQL, always re-executes | None |
| **versioned** (default under `migrations/`, `flux/migrations/`, `sql/migrations/`) | One-time schema migrations | `flux.flux_migrations` |
| **repeatable** (`--mode repeatable`) | Idempotent desired-state scripts | `flux.flux_repeatable_scripts` |

```bash
flux push flux-init.sql                      # raw (default)
flux push flux-init.sql --mode raw           # explicit raw
flux push migrations/0001_moods.sql          # versioned (default under migrations/)
flux push db/seed.sql --mode repeatable --force
```

### Plan, dry run, and ledger

```bash
flux push migrations/ --plan      # show skip / would apply / conflicts
flux push migrations/ --dry-run   # validate conflicts and size; apply nothing
flux migrations list              # show flux.flux_migrations for the project
```

**`--plan`** prints what would happen (including conflicts) and exits without applying SQL. For each pending file it also prints a **heuristic** DDL summary (creates/alters/DROP warnings)—review the SQL files for certainty.

**`--dry-run`** builds the same plan, fails on checksum conflicts or oversized files, and applies nothing—useful in CI before a real push.

**`flux migrations list`** reads the remote ledger only (not your local folder). For full flag detail (directory vs file, `--plan` vs `--dry-run`), run **`flux push --help`** and **`flux migrations --help`** on your installed CLI.

**`flux migrations`** is the SQL ledger inspector—not **`flux migrate`** (engine conversion from v2 shared to v1 dedicated).

In CI, use non-interactive tokens, pinned **`FLUX_API_BASE`**, and either the same flags or a checked-in **`flux.json`** with **`slug`** + **`hash`** so pipelines do not drift.

### Dedicated projects: the push-time security gate

`v1_dedicated` APIs route from Traefik directly to the project's PostgREST container; they do not pass through the pooled Flux gateway. Bootstrap grants PostgREST roles access to exposed tables on the assumption that RLS will restrict that access. `flux push` now checks that assumption against **effective** database privileges, not HTTP status codes.

After applying your SQL, the audit runs **inside the same transaction**. It rejects the push (`42501`), rolls back the user SQL, and does not record the migration ledger when an exposed table has RLS disabled **and** `anon`, `authenticated`, or `PUBLIC` has effective `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE` (directly, through role membership, or through `PUBLIC`).

These conditions are warnings, not failures:

- RLS disabled with only `SELECT` or with no PostgREST privileges (unrestricted reads may be intentional or sensitive)
- RLS enabled with zero policies (Postgres denies non-owner access by default, so this is secure but likely unusable)

A migration that repairs an existing unrestricted-write table is allowed because the audit runs after that migration's SQL and before commit. For an intentionally inaccessible table, use an explicit deny-all policy so Flux does not warn about a policyless table:

```sql
ALTER TABLE api.internal_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY internal_queue_deny_all ON api.internal_queue
  USING (false)
  WITH CHECK (false);
```

Run `flux doctor <project>` to audit an existing dedicated project. The **API schema RLS** check **FAIL**s unrestricted-write tables (naming tables, roles, and privileges) and **WARN**s on read-only RLS-disabled exposure and policyless RLS. `flux db inspect` still exposes RLS state as table-level warnings. Flux does not automatically enable RLS, create policies, or revoke grants.

Live `v1_dedicated` fleet audits remain a rollout step after this gate ships; merging the code does not by itself close GitHub issue #8.

### Who runs your SQL on v2_shared

On pooled projects, Flux executes pushed SQL as a per-tenant **owner role**, `t_<shortId>_ddl`, with `search_path` set to your tenant schema only. That is deliberately **not** the role your JWT uses at request time (`t_<shortId>_role`): in PostgreSQL a table owner bypasses row-level security, so if migrations ran as the runtime role, every table it created would silently stop enforcing RLS for your own app.

Two consequences for your migrations:

- **Objects you create are owned by `t_<shortId>_ddl`, not by your JWT role.** `SELECT` is granted automatically; **writes still need an explicit grant**, exactly as before:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE t_<shortId>_api.notes TO t_<shortId>_role;
```

- **RLS is forced.** After each push, any tenant table that has RLS enabled but not forced gets `FORCE ROW LEVEL SECURITY`. This changes nothing for normal app traffic. If you need a table readable by its owner regardless of policy, mark it explicitly:

```sql
COMMENT ON TABLE t_<shortId>_api.audit_log IS 'flux:no-force-rls — append-only, read via view';
```

Tables **without** RLS enabled are never modified. A push is rejected if the runtime role is found owning objects in the tenant schema, since that would disable RLS for that role.

### SECURITY DEFINER functions and FORCE RLS

On **v2_shared**, a `SECURITY DEFINER` function in the tenant schema is owned by `t_<shortId>_ddl`. That role is not a superuser and does not have `BYPASSRLS`. `FORCE ROW LEVEL SECURITY` applies to the owner, so policies written only `TO t_<shortId>_role` (including `TO authenticated`, which push rewrites to that role) do not apply while the function runs. A `SELECT` then returns **zero rows and no error**. Writes fail with a row-level security error instead of bypassing the policy.

This shipped with the Pass 6b ownership backfill. It is invisible to control-plane `/api/health`. `flux doctor` on a v2 project **fails** the **Definer RLS** check when it sees the shape. `flux push` **warns** and still commits, so a project that already has a blinded helper can ship the repair. The warning is not a rollback: the repair belongs in the app's next migration, and the detector is a heuristic.

After this check is deployed, a tenant that still has a real blinded definer shows doctor **FAIL** until the repair migration is pushed as **versioned** (so it is recorded in `flux.flux_migrations`). **parcelpop** is in that state today: repair `0035` exists in the app repo but is not recorded in its migration ledger, so doctor stays failed until that file is pushed as versioned. A repair that was applied by hand, or as a repeatable/raw script, does not clear the check.

The scan reads `pg_proc` source text after stripping comments (`--` through the end of that line, and `/* … */` blocks, including a block comment that spans lines). It matches `FROM` / `JOIN` of an ordinary lowercase table (`relkind = 'r'`), including a schema-qualified name with or without space around the dot (`t_<shortId>_api.notes` and `schema . table`). It does **not** read tenant rows, and it does not return function bodies. Limits, honestly:

- Dynamic SQL that builds the table name at runtime (`EXECUTE format('SELECT … FROM %I', …)`, concatenation) is not detected.
- A later comma-separated item (`FROM other, notes`), a read that only goes through a view, and quoted mixed-case identifiers are not detected.
- A string literal that contains `FROM notes` or `JOIN notes` can be flagged even when that statement never runs.
- Procedures are not scanned.

Repair it with a **new** migration. Add a permissive `SELECT` policy scoped to the function owner (`pg_proc.proowner`, normally `t_<shortId>_ddl`). Keep `USING` as narrow as the helper is supposed to be. Do **not** `ALTER ROLE … BYPASSRLS`, do **not** `NO FORCE ROW LEVEL SECURITY`, and do **not** drop RLS. Do **not** use `TO PUBLIC` just to unstick the helper: a policy with no `TO` is `TO PUBLIC`, which also admits every other role that can reach the table.

```sql
CREATE POLICY members_definer_select ON members
  FOR SELECT
  TO t_<shortId>_ddl
  USING (true); -- narrow this to the rows the helper is allowed to see
```

An `INSERT` / `UPDATE` / `DELETE` inside the definer needs the matching command policy for that same owner role. The runtime role's policies stay unchanged. This policy only admits the owner, which is who the definer runs as.

### Foundry / Supabase-style SQL on v2_shared

Foundry repos often ship **unqualified** DDL (`CREATE TABLE profiles …`) and privilege boilerplate (`GRANT … TO authenticated`, `GRANT USAGE ON SCHEMA public …`). On **v2_shared**, `flux push` applies SQL inside a transaction with:

```sql
SET LOCAL ROLE t_<shortId>_ddl;
SET LOCAL search_path TO t_<shortId>_api;
```

**Object placement:** Unqualified `CREATE TABLE` / indexes / policies resolve in **`t_<shortId>_api`** (not `public`).

**Privileges:** Your SQL runs as the per-tenant owner role, not the control-plane role. Statements needing superuser — most commonly **`CREATE EXTENSION`** — are rejected; ask an operator to install extensions cluster-wide. Ledger writes happen after `RESET ROLE` so the migration record cannot be forged by pushed SQL.

**Role rewrite (execution-time only):** The control plane adapts privilege statements before execution:

- `authenticated` → `t_<shortId>_role` (the same role the gateway mints on bridge JWTs)
- `GRANT|REVOKE … ON SCHEMA public` → tenant API schema
- `ALTER DEFAULT PRIVILEGES IN SCHEMA public` → tenant API schema

Qualified **`public.<object>`** references are deliberately left alone, since `public` holds the PostgREST hook functions and any operator-installed extensions.

Migration **checksums** and ledger rows remain on normalized file content (no rewrite in Git). **`anon`** grants are preserved when present (cluster-global role).

**Runtime JWTs:** Apps still mint project JWTs with `role: "authenticated"`; the gateway maps that to `t_<shortId>_role` before PostgREST — see [Bridge JWTs](/docs/architecture/bridge-jwts).

### Legacy pooled ledger (operators)

On **v2_shared**, the migration ledger is **`flux.flux_migrations`** with primary key **`(tenant_schema, version)`**. Shared Postgres clusters that ran migrations before Pass 1B may still have a **legacy global ledger** ( **`version`** only). Directory **`flux push`** inspects that table before applying files.

| State | What happens |
|-------|----------------|
| No ledger table | First push creates tenant-scoped ledger |
| Legacy table, zero rows | Next directory push auto-upgrades |
| Legacy table with rows | Push fails closed — run **`bin/migrate-pooled-ledger.sh`** on the Flux host |
| Already tenant-scoped | No action |

```bash
# On the server (repo checkout, flux-web running):
./bin/migrate-pooled-ledger.sh --assign-legacy-to t_<shortId>_api --dry-run
./bin/migrate-pooled-ledger.sh --assign-legacy-to t_<shortId>_api
```

Use **`--assign-legacy-to`** only when **all** legacy rows belong to that tenant schema (from **`flux list`** / project catalog). After upgrade, run **`flux push migrations/ --plan`** per project; migrations applied earlier via single-file push may need ledger rows before directory push will skip them.

## Example

Wrap breaking changes in transactions where appropriate; test dumps on a scratch project before production.

## Next steps

- [Migrations (concepts)](/docs/concepts/migrations)
- [Pooled → dedicated migrate](/docs/guides/v2-to-v1-migrate)
- [CLI reference](/docs/reference/cli)
