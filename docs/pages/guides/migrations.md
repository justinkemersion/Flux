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

Every push must resolve a project. From your machine, pass **`--project`** and **`--hash`** from **`flux list`** (example values—use yours), or put **`slug`** and **`hash`** in repo-root **`flux.json`**.

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

### Single-file push (unchanged)

```bash
flux push db/migrations/0001_moods.sql --project percept --hash b915ec8
```

Single-file pushes do **not** write to the migration ledger—use directory mode when you want Flux to own ordering and idempotency.

### Plan, dry run, and ledger

```bash
flux push migrations/ --plan      # show skip / would apply / conflicts
flux push migrations/ --dry-run   # validate conflicts and size; apply nothing
flux migrations list              # show flux.flux_migrations for the project
```

**`--plan`** prints what would happen (including conflicts) and exits without applying SQL.

**`--dry-run`** builds the same plan, fails on checksum conflicts or oversized files, and applies nothing—useful in CI before a real push.

**`flux migrations list`** reads the remote ledger only (not your local folder).

In CI, use non-interactive tokens, pinned **`FLUX_API_BASE`**, and either the same flags or a checked-in **`flux.json`** with **`slug`** + **`hash`** so pipelines do not drift.

## Example

Wrap breaking changes in transactions where appropriate; test dumps on a scratch project before production.

## Next steps

- [Migrations (concepts)](/docs/concepts/migrations)
- [Pooled → dedicated migrate](/docs/guides/v2-to-v1-migrate)
- [CLI reference](/docs/reference/cli)
