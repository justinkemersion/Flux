---
title: RLS boundaries
description: What row-level security fixes, what it does not, and operator vs application responsibilities.
---

# RLS boundaries

**RLS** filters rows for a given SQL statement. It does **not** replace network controls, gateway verification, or correct **GRANT** configuration.

## What you will learn

- GRANT vs policy order of operations
- Failure modes: empty results vs errors
- When Flux’s baseline v2 model does not enable RLS by default

## The idea

Postgres evaluates privileges **before** RLS filters. If the role cannot `SELECT` the table, you see **`42501`**, not “zero rows”.

On **v2**, the architecture spec notes RLS is **not required initially** for the baseline threat model—schema + role separation carries much of the isolation story. Adding RLS is an **application** choice with performance and complexity tradeoffs.

## How it works

Typical checklist:

1. `GRANT` appropriate table/schema privileges to the JWT role.
2. `ENABLE ROW LEVEL SECURITY`.
3. Add policies that reference stable claims (`sub`, org id, …).
4. Test with real tokens, not only superuser sessions.

## Example

A policy that compares UUID to `text` claim incorrectly can silently return no rows—type discipline matters.

## Next steps

- [Row-level security (concepts)](/docs/concepts/rls)
- [Auth.js guide](/docs/guides/authjs)
