---
title: Migrations workflow
description: Practical workflow for SQL migrations, tenant schemas, and flux push.
---

# Migrations workflow

Treat SQL files in Git as **canonical**. `flux push` applies them to the tenant database and triggers PostgREST reload.

## What you will learn

- Why schema naming matters on v2
- Idempotency habits
- How to validate after push

## The idea

On **v2 shared**, create objects in your **`t_<shortId>_api`** schema (name from the platform—not the marketing slug). Creating only in `public` often yields permission errors at request time.

After push, wait briefly for reload before assuming new tables exist in PostgREST’s cache.

## How it works

```bash
flux push ./db/migrations/001_init.sql
flux push ./db/migrations/002_indexes.sql
```

In CI, use non-interactive tokens and pinned `FLUX_API_BASE`.

## Example

Wrap breaking changes in transactions where appropriate; test dumps on a scratch project before production.

## Next steps

- [Migrations (concepts)](/docs/concepts/migrations)
- [CLI reference](/docs/reference/cli)
