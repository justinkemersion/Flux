---
title: Migrations
description: SQL-first schema changes with flux push and PostgREST schema reload.
---

# Migrations

Flux treats **SQL** as the source of truth. You apply migrations with the CLI (`flux push` and related flows) so tenant databases evolve predictably and PostgREST picks up schema changes.

## What you will learn

- How pushes reach Postgres
- Why **tenant schema** placement matters on v2
- What happens after SQL runs

## The idea

After SQL executes in the tenant database, Flux triggers PostgREST reload (notify + signal—see `README.md` in the repo). Until reload completes, you might see stale shape errors briefly.

On **v2 shared**, tables for your API must live in the tenant schema (e.g. `t_<shortId>_api`), not an assumed `public` layout—otherwise you will see permission errors when PostgREST evaluates requests.

## How it works

Target the project explicitly (slug and 7-character hash from **`flux list`**, or the same fields in **`flux.json`**):

```bash
flux push db/migrations/0001_moods.sql --project percept --hash b915ec8
```

Replace **`percept`** / **`b915ec8`** with the values from your listing.

Author SQL idempotently where possible (`IF NOT EXISTS`, defensive guards). For pooled tenants, set `search_path` or schema-qualify objects explicitly.

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
