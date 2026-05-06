---
title: Simple CRUD example
description: Smallest vertical slice—table, migration, and HTTP verbs against PostgREST.
---

# Simple CRUD example

A minimal Flux app defines a table, applies SQL, then uses PostgREST’s resource interface for **select / insert / patch / delete**.

## What you will learn

- Baseline migration shape
- HTTP examples aligned with PostgREST
- Auth reminder at the edge

## The idea

PostgREST maps tables to `/<table>` with query parameters for filters (`col=eq.value`). Mutations set `Content-Type: application/json` and include `Authorization` per your engine.

## How it works

### SQL

```sql
CREATE TABLE IF NOT EXISTS t_shortid_api.items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);
```

Replace `t_shortid_api` with your tenant schema.

### HTTP

```bash
curl "$FLUX_URL/items?select=*" -H "Authorization: Bearer $TOKEN"
```

```bash
curl "$FLUX_URL/items" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"hello"}'
```

## Example

Use `Prefer: return=representation` when you want inserted rows in the response (PostgREST feature).

## Next steps

- [First request](/docs/getting-started/first-request)
- [Multi-tenant app](/docs/examples/multi-tenant-app)
