---
title: Row-level security
description: Using Postgres RLS with PostgREST for multi-tenant row isolation.
---

# Row-level security

**Row-level security (RLS)** filters which rows a SQL statement may see or change. With PostgREST, RLS runs under the database role derived from the JWT. Policies reference claims such as **`sub`** or app-specific fields.

## What you will learn

- Why **GRANT** matters as much as policies
- Typical policy shape for per-user rows
- Footguns (type mismatches, missing grants)

## The idea

RLS is not a network control—it assumes the role is already allowed to touch the table. Without `GRANT`, PostgREST returns **403** / `42501`, not an empty list.

Flux does not require RLS on every project; **v2**’s baseline isolation is schema + role boundaries. RLS is an additional app-level tool—see architecture spec for current defaults.

## How it works

Enable RLS and add policies:

```sql
ALTER TABLE t_abc123_api.items ENABLE ROW LEVEL SECURITY;

CREATE POLICY items_owner_select ON t_abc123_api.items
  FOR SELECT TO authenticated
  USING (owner_id = current_setting('request.jwt.claims', true)::json->>'sub');
```

Also grant table privileges to the role your JWT uses.

## Example

If `sub` is `text` in the database but you compare to a UUID cast incorrectly, policies silently exclude rows—verify types.

## Next steps

- [RLS boundaries (security)](/docs/security/rls-boundaries)
- [Auth.js guide](/docs/guides/authjs)
