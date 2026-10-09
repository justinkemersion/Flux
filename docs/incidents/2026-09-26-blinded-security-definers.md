# 2026-09-26 — SECURITY DEFINER functions blinded by FORCE RLS

- Last updated: `2026-09-26`
- Impact: tenant helpers returned zero rows for about seven weeks. Control-plane `/api/health` and `flux doctor` stayed green.

## What happened

The Pass 6b ownership backfill (applied 2026-08-08) re-owned objects in `t_<shortId>_api` to `t_<shortId>_ddl` and enabled `FORCE ROW LEVEL SECURITY` on tables that already had RLS. The DDL role has no `BYPASSRLS`. Tenant policies name `t_<shortId>_role` only.

A `SECURITY DEFINER` function runs as its owner. After the backfill that owner is the DDL role, so those policies do not apply. A read of a forced table returns zero rows and does not error.

Lighthouse was the outage that surfaced it. A read-only catalog scan of the fleet found the same shape in parcelpop (7 helpers, including magic-token and membership), noisydesign (5 `resolve_*` helpers), and darn (1). Lighthouse repaired itself with a tenant migration: a `SELECT` policy on the affected table for `pg_proc.proowner`. This repository does not apply those repairs.

## What shipped

Detection only.

- `flux push` on v2 **warns** and still commits. Failing the push would block unrelated migrations on tenants that already have the shape, and the detector is lexical.
- `flux doctor` on v2 **fails** the Definer RLS check. The check is catalog-only: function name, owner role, and table name. No tenant rows, no function source. After deploy, a tenant that still has a real blinded definer shows that **FAIL** until the repair is pushed as a versioned migration. parcelpop's repair `0035` is not recorded in its migration ledger, so doctor stays failed for that tenant until `0035` is pushed as versioned.

## Heuristic limits

The scan matches `FROM` / `JOIN` of an ordinary lowercase table in function source after comments are stripped, including `schema.table` with no space around the dot. A `--` comment hides only the rest of that line.

- Dynamic SQL that builds the table name at runtime is not detected.
- A string literal that contains `FROM` or `JOIN` of the table name can be flagged.
- Comma-style `FROM a, notes`, reads that only go through a view, and quoted mixed-case identifiers are not detected.

## Repair

A new migration in the app repo. Permissive `SELECT` policy `TO` the function owner. Never `BYPASSRLS`. Never `NO FORCE ROW LEVEL SECURITY`. See [`docs/pages/guides/migrations.md`](../pages/guides/migrations.md).
