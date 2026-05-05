# Migration module spec (v2_shared → v1_dedicated)

**Status:** Aligned with [migration_plan.md](./migration_plan.md) (mirrored tenant schema, v0).

**Tenant identity:** Catalog UUID is `projects.id`. Engine-v2 and `flux push` derive `t_<shortId>_api` from that same id (`deriveShortId(projects.id)`). There is no separate `tenant_id` column.

---

## Mental model

Migration is **data-plane relocation** plus a **control-plane flip** at the end.

You are **not** rewriting schema names in SQL for v0. Source and target both use `t_<shortId>_api`.

You **are**:

* Dumping `t_<shortid>_api` from the shared cluster
* Restoring into a dedicated Postgres + PostgREST stack that exposes the **same** schema name
* Switching routing / `projects.mode` only after validation

---

## High-level architecture

```
CLI
 └── @flux/cli
      └── migrate command
            ↓
      @flux/migrate
            ↓
      @flux/core (provision v1, execute SQL)
            ↓
      postgres (source: shared) ── pg_dump
      postgres (target: dedicated) ── restore
```

---

## Module layout (`packages/migrate/`)

```
packages/migrate/
  src/
    index.ts
    plan.ts
    inspect.ts
    dump.ts
    restore.ts
    validate.ts
    switch.ts
    types.ts
```

There is **no** `transform.ts` in v0 (no `t_* → api` rewrite).

---

## Core types (`types.ts`)

```ts
export type MigrationPlan = {
  projectSlug: string
  /** Same as catalog `projects.id` */
  projectId: string
  shortId: string
  tenantSchema: string

  source: {
    mode: 'v2_shared'
    schema: string
  }

  target: {
    mode: 'v1_dedicated'
    /** Same schema name as source — mirrored model */
    schema: string
  }

  preserveJwtSecret: boolean
  lockWrites: boolean
}

export type MigrationResult = {
  success: boolean
  phase: string
  error?: string
}
```

---

## Steps (summary)

1. **plan.ts** — `buildMigrationPlan`: load project; `mode === v2_shared'`; `jwt_secret` present; `shortId` / schema from `projectId`.
2. **inspect.ts** — Preflight counts + `obj_description(schema)` must be `tenant:<projectId>`.
3. **dump.ts** — `pg_dump --schema=t_<shortId>_api --no-owner --no-acl`.
4. **Provision target** — `ProjectManager.provisionProject` with tenant schema + preserved JWT; no routing flip until switch phase.
5. **restore.ts** — Drop/recreate tenant schema on target, apply dump, reapply parameterized grants / `auth.uid()`, reload PostgREST.
6. **validate.ts** — Row counts, sequences, smoke JWT + GET.
7. **switch.ts** — `projects.mode = v1_dedicated`, infra pointers, evict gateway `hostname:*` cache.

On any failure **before** switch: source stays live; clear `migration_status`; target may be abandoned.

---

## CLI (`packages/cli/src/commands/migrate.ts`)

* `--project` / `-p`, `--to v1_dedicated`
* `--dry-run`, `--yes`, `--keep-source`, `--drop-source-after`, `--preserve-jwt-secret`, `--new-jwt-secret`, `--validate-only`, `--lock-writes` / `--no-lock-writes`, `--output-plan`
* Staged flags from migration_plan: `--dump-only`, `--staged` as needed

---

## Tests

* Plan builder edge cases (wrong mode, missing secret)
* No transform tests in v0
* Integration: dump + restore round-trip, JWT still works, gateway 503 while `migration_status = migrating`

---

## v0 constraints

* Downtime allowed; optional write lock + 503 on gateway during migrate
* Source retained by default
* No zero-downtime, cross-region, or live replication
