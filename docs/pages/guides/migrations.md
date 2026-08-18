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

### Dedicated projects: the push-time RLS gate

`v1_dedicated` APIs route from Traefik directly to the project's PostgREST container; they do not pass through the pooled Flux gateway. Every base or partitioned table in the exposed API schema must therefore have RLS enabled and at least one explicit policy.

After applying your SQL, `flux push` audits the live catalog **inside the same transaction**. If it finds RLS disabled or RLS enabled with zero policies, it raises `42501`, rolls back the user SQL and migration-ledger write, and does not reload PostgREST.

The repair belongs in a new migration. The audit runs after that migration's SQL, so one push can enable RLS and add the missing policies. For an intentionally inaccessible table, use an explicit deny-all policy:

```sql
ALTER TABLE api.internal_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY internal_queue_deny_all ON api.internal_queue
  USING (false)
  WITH CHECK (false);
```

Run `flux doctor <project>` to audit an existing dedicated project. The **API schema RLS** check names tables that are disabled or policyless. `flux db inspect` exposes the same facts as table-level warnings.

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
