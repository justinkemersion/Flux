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

On **v1 dedicated**, Traefik routes directly to the project's PostgREST container. There is no Flux gateway authentication layer, so an RLS-disabled table that still grants write access to `anon`, `authenticated`, or `PUBLIC` is world-writable. `flux push` enforces that unrestricted-write invariant transactionally (effective privileges, including inherited and `PUBLIC` grants). RLS disabled with only reads, and RLS enabled with no policies, are warnings — the latter is secure by default in Postgres but usually unintentional. `flux doctor` uses the same classification.

On **v2 shared**, gateway authentication plus schema and role separation are the platform boundary. When an app enables RLS, Flux also applies `FORCE ROW LEVEL SECURITY`, so the table owner (`t_<shortId>_ddl`) does not skip policies. A `SECURITY DEFINER` function runs as that owner. If the table's `SELECT` policies name only the runtime role, the function sees zero rows and does not error. `flux doctor` fails the **Definer RLS** check for that catalog shape (names of function, owner role, and table only — no row data, no function source). `flux push` warns and still commits. The repair is a tenant migration: a permissive `SELECT` policy `TO` the function owner. Do not grant `BYPASSRLS` and do not disable `FORCE ROW LEVEL SECURITY`. The detector reads function source text; dynamic SQL that assembles the table name at runtime is not detected. See [Migrations](/docs/guides/migrations).

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
