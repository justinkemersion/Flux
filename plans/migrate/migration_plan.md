# 📦 Flux Migration Spec (v2_shared → v1_dedicated)

## Status: IMPLEMENTED (v0)

- Mirrored schema model adopted (`t_<shortid>_api` on v2, new v1, and post-migrate dedicated).
- Migration is schema-preserving (no SQL rewrite / transform layer in v0).
- Core, dashboard, gateway (`migration_status` → 503), CLI, and `@flux/migrate` helpers are wired.
- Orchestration supports dry-run, staged mode, optional source drop, and binary preflight (`pg_dump`, shared URL).

**Remaining hardening (see repo issues / follow-up PRs):** deeper PostgREST+JWT smoke after restore, broader E2E matrix, advisory lock against concurrent migrate, and removing `FLUX_V1_TENANT_SCHEMA` once tenant-schema v1 is default everywhere.

**Feature flag removal checklist:** migration stable in production; new v1 tenant-schema path clean; then drop `FLUX_V1_TENANT_SCHEMA` and make tenant schema the default for new v1 projects.

---

**Status (design):** Canonical operational flow for v0+
**Date:** 2026-05-04
**Scope:** Data-plane migration with control-plane switch
**Source:**  (refined and aligned)

---

# 🧠 Core invariant (do not break this)

```txt
Every Flux project has exactly one canonical API schema derived from tenant identity.
```

Therefore:

```txt
v2_shared:      t_<shortid>_api
v1_dedicated:   t_<shortid>_api   (new + migrated)
legacy v1:      api               (unchanged)
```

---

# 🎯 Core promise

```bash
flux migrate --project bloom --to v1_dedicated
```

Meaning:

> Move a `v2_shared` tenant into a dedicated `v1_dedicated` stack **without changing schema identity or API contract**.

---

# ⚠️ Architectural shift (critical)

❌ Old assumption:

```txt
t_<shortid>_api → api (requires SQL transform)
```

✅ New model:

```txt
t_<shortid>_api → t_<shortid>_api (no schema rewrite)
```

**Impact:**

* No SQL transform layer required for v0
* No risk from function/view/policy rewriting
* Migration becomes relocation, not translation

---

# 🧩 CLI shape

```bash
flux migrate \
  --project bloom \
  --to v1_dedicated
```

### Flags

```bash
--dry-run
--yes
--keep-source
--drop-source-after
--preserve-jwt-secret
--new-jwt-secret
--validate-only
--lock-writes
--no-lock-writes
--output-plan
```

### v0 usage

```bash
flux migrate --project bloom --to v1_dedicated --dry-run
flux migrate --project bloom --to v1_dedicated --yes
```

---

# 🧭 Migration phases

---

## 1. Resolve project

Load from `flux-system.projects`.

Validate:

* project exists
* project.mode === `v2_shared`
* project has:

  * `id` (UUID) — canonical tenant identity; same value passed to engine-v2 as `tenantId` on create
  * `jwt_secret`
  * `slug` / `hash` / resolvable API URL

Fail fast.

---

## 2. Derive canonical identity

```ts
projectId: uuid   // projects.id
shortId: deriveShortId(projectId)
schema: `t_${shortId}_api`
role: `t_${shortId}_role`
```

Validate:

* schema exists
* schema comment = `tenant:<uuid>`
* role exists
* ownership matches project

---

## 3. Preflight inspection

Collect:

* tables
* row counts
* sequences
* views
* functions
* triggers
* policies
* extensions
* estimated size

Output:

```txt
Project: bloom
From: v2_shared schema t_ab12cd34ef56_api
To:   v1_dedicated schema t_ab12cd34ef56_api

API URL: preserve
JWT secret: preserve
Writes: locked
Source cleanup: keep

Objects:
  tables: 12
  rows: 1842
  views: 2
  functions: 4
  policies: 7
```

---

## 4. Write lock (recommended for v0)

```txt
Tenant enters maintenance mode.
All API traffic returns 503.
```

Implementation:

* `migration_status = "migrating"`
* gateway rejects requests

---

## 5. Provision dedicated target

Create new v1 stack:

* Postgres container
* PostgREST container

Bootstrap using:

```txt
api_schema_name = t_<shortid>_api
```

PostgREST config:

```txt
PGRST_DB_SCHEMAS=t_<shortid>_api,public
```

JWT:

```txt
PGRST_JWT_SECRET = source.jwt_secret (if preserved)
```

❗ Do NOT expose publicly yet
❗ Do NOT switch routing

---

## 6. Dump source schema

```bash
pg_dump \
  --schema=t_<shortid>_api \
  --no-owner \
  --no-acl \
  --format=plain
```

No transformation required.

---

## 7. Restore into target

Steps:

```txt
DROP SCHEMA t_<shortid>_api CASCADE (if exists)
CREATE SCHEMA t_<shortid>_api
```

Restore dump directly.

Then:

```txt
reapply API_SCHEMA_PRIVILEGES_SQL (parameterized)
reapply auth.uid()
NOTIFY pgrst, 'reload schema'
SIGUSR1 PostgREST
```

---

## 8. Validate target

Minimum:

* tables exist
* row counts match
* sequences valid
* policies exist
* functions exist
* `auth.uid()` works
* JWT works
* PostgREST returns data correctly

Optional:

* sequence next values
* sample data checks
* checksum

---

## 9. Switch routing (critical boundary)

Only after validation:

* project.mode → `v1_dedicated`
* update infra pointers
* preserve:

  * API URL
  * JWT secret
* evict gateway cache

---

## 10. Cleanup source

Default:

```bash
--keep-source
```

Later:

```bash
flux migrate cleanup --project bloom
```

or:

```bash
--drop-source-after
```

---

# 🔁 Internal state model

```ts
migration_status:
  | null
  | "planning"
  | "provisioning_target"
  | "dumping"
  | "restoring"
  | "validating"
  | "switching"
  | "complete"
  | "failed"
```

---

# ❌ Failure behavior

Rule:

```txt
Never switch unless validation passes.
```

If failure:

* source remains active
* target is abandoned or kept
* maintenance mode lifted
* error reported with phase

---

# 🧪 MVP implementation phases

---

## Phase 1 — Dry run

```bash
flux migrate --dry-run
```

* validate project
* inspect schema
* print plan

---

## Phase 2 — Dump only

```bash
flux migrate --dump-only
```

* verifies extraction

---

## Phase 3 — Staged restore

```bash
flux migrate --staged
```

* full migration except switch

---

## Phase 4 — Full migration

```bash
flux migrate --yes
```

---

# 🧪 Test matrix

Must cover:

* project not found
* wrong mode
* missing schema
* schema comment mismatch
* missing role
* invalid JWT secret
* large datasets
* sequences
* views
* functions
* triggers
* policies
* restore failure
* validation failure
* gateway cache eviction
* rollback correctness
* JWT preserved after switch

---

# 🧠 v0 guarantees

```txt
✔ downtime allowed
✔ source retained
✔ schema identity preserved
✔ API URL preserved (goal)
✔ JWT preserved (default)
✔ no silent transforms
✔ switch only after validation
```

---

# 🚫 Explicit non-goals (v0)

* zero-downtime migration
* cross-region migration
* live replication
* SQL transformation layer
* legacy v1 schema rewrite
* multi-tenant merge/split

---

# 🎯 Final system property

After this transition:

```txt
shared → dedicated
same tenant id
same schema
same JWT
same API
```

That is the Flux promise.

---

# 💡 Final note (important)

This change does more than simplify migration.

It unifies the system:

```txt
v2_shared and v1_dedicated now share the same data model
```

Which means:

* less conditional logic
* fewer bugs
* simpler mental model
* stronger product story

