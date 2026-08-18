---
title: RLS boundaries
description: What row-level security fixes, what it does not, and operator vs application responsibilities.
section: security
---

# RLS boundaries

**RLS** filters rows for a given SQL statement. It does **not** replace network controls, gateway verification, or correct **GRANT** configuration.

## What you will learn

- GRANT vs policy order of operations
- Failure modes: empty results vs errors
- Why dedicated projects require RLS while pooled projects have another platform boundary

## The idea

Postgres evaluates privileges **before** RLS filters. If the role cannot `SELECT` the table, you see **`42501`**, not “zero rows”.

On **v2**, the architecture spec notes RLS is **not required initially** for the baseline threat model—gateway authentication plus schema and role separation carry the platform isolation story. Adding RLS is an **application** choice with performance and complexity tradeoffs.

On **v1 dedicated**, Traefik routes directly to the project's PostgREST container. There is no Flux gateway authentication layer, so RLS is mandatory on every table in the exposed API schema. `flux push` enforces that invariant transactionally, and `flux doctor` audits existing projects. RLS enabled with no policies denies access, but Flux still requires an explicit policy so an accidental incomplete migration is visible; use a deny-all policy when that behavior is intentional.

## How it works

Typical checklist:

1. `GRANT` appropriate table/schema privileges to the JWT role.
2. `ENABLE ROW LEVEL SECURITY`.
3. Add policies that reference stable claims (`sub`, org id, …).
4. Test with real tokens, not only superuser sessions.

## Example

A policy that compares `uuid` to a `text` claim silently returns no rows—type discipline matters. The full diagnostic flow for "empty array instead of error" lives in [Troubleshooting](/docs/reference/troubleshooting#empty-array-instead-of-an-error); the diagnostic for `42501` (when the role cannot reach the table at all, before RLS is even consulted) is at [Troubleshooting → 42501](/docs/reference/troubleshooting#42501-permission-denied).

## Next steps

- [Row-level security (concepts)](/docs/concepts/rls)
- [Auth.js guide](/docs/guides/authjs)
- [Troubleshooting](/docs/reference/troubleshooting)
