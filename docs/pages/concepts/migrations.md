---
title: Migrations
description: SQL-first schema changes with flux push and PostgREST schema reload.
section: concepts
---

# Migrations

Flux treats **SQL** as the source of truth. You apply migrations with the CLI (`flux push` and related flows) so tenant databases evolve predictably and PostgREST picks up schema changes.

## What you will learn

- How pushes reach Postgres
- Why **tenant schema** placement matters on v2
- What happens after SQL runs

## The idea

After SQL executes in the tenant database, Flux triggers PostgREST reload (**notify** plus **signal** to the API process). Until reload completes, you might see stale shape errors briefly.

On **v2 shared**, tables for your API must live in the tenant schema (e.g. `t_<shortId>_api`), not an assumed `public` layout—otherwise you will see permission errors when PostgREST evaluates requests.

## How it works

Target the project explicitly (slug and 7-character hash from **`flux list`**, or the same fields in **`flux.json`**).

**Directory mode** applies an ordered set of `.sql` files and records each success in a tenant-local ledger table (`flux.flux_migrations` in the reserved **`flux`** schema—not exposed via PostgREST). On **v2_shared**, the ledger is keyed by **`(tenant_schema, version)`** so pooled tenants do not share migration rows.

**Single-file push** supports three modes: **raw** (no ledger; default outside migration folders), **versioned** (ledger in `flux.flux_migrations`; default under `migrations/`, `flux/migrations/`, or `sql/migrations/`), and **repeatable** (ledger in `flux.flux_repeatable_scripts`; re-runs when checksum changes, or with `--force`).

**Do not edit a versioned migration after it has been applied. Create a new migration instead.** Flux compares checksums on every versioned push; changed files raise a clear conflict instead of silently re-running SQL.

```bash
flux push migrations/
flux push flux/scripts/seed.sql --mode repeatable --force
flux push db/migrations/0001_moods.sql --mode versioned --project percept --hash b915ec8
```

Replace **`percept`** / **`b915ec8`** with the values from your listing.

Author SQL idempotently where possible (`IF NOT EXISTS`, defensive guards). For pooled tenants, unqualified DDL resolves via push `search_path`; explicit **`GRANT … TO authenticated`** and **`ON SCHEMA public`** (Foundry-style app SQL) are rewritten to the tenant role/schema at execution time. You may also schema-qualify with `t_<shortId>_api` directly.

Use **`flux push migrations/ --plan`**, **`--dry-run`**, and **`flux migrations list`** to inspect pending work and the ledger before applying.

**Operators (v2_shared):** If directory push fails because a **legacy global ledger** still has rows without **`tenant_schema`**, upgrade the shared table once with **`bin/migrate-pooled-ledger.sh --assign-legacy-to t_<shortId>_api`** on the Flux host. See [Guides: migrations](/docs/guides/migrations) (legacy pooled ledger) and the root README.

## Example

```sql
CREATE TABLE IF NOT EXISTS t_abc123_api.items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);
```

Replace with your actual schema name from the platform.

## Next steps

- [Guides: migrations](/docs/guides/migrations)
- [Service URLs](/docs/concepts/service-urls) (profiles when bypassing gateway)
