# Flux v1 Schema Mirroring Transition Plan

> **Note:** Despite the filename `SQL_transform_layer.md`, v0 migration **does not** use a SQL transform layer; the goal is to **avoid** rewriting dumps by keeping `t_<shortid>_api` on both v2 and new v1 stacks.

## Decision

Flux will move toward a mirrored tenant-schema model:

```txt
Existing v1_dedicated projects:  api
New v1_dedicated projects:       t_<shortid>_api
v2_shared projects:              t_<shortid>_api
v2 → v1 migrated projects:        t_<shortid>_api
```

Core invariant:

```txt
All new Flux projects have a canonical API schema derived from tenant identity.
```

Legacy invariant:

```txt
Existing v1 projects using api remain supported.
```

---

# Why

This reduces `flux migrate` risk.

Instead of transforming:

```txt
t_<shortid>_api → api
```

migration becomes:

```txt
t_<shortid>_api → t_<shortid>_api
```

That avoids dangerous SQL rewrites in:

* functions
* triggers
* views
* policies
* sequence literals
* COPY headers
* quoted identifiers

---

# New schema model

## Project schema mode

Add or derive a project-level concept:

```ts
type ApiSchemaStrategy =
  | "legacy_api"
  | "tenant_schema"
```

Rules:

```txt
v1_dedicated existing row with no tenant schema marker → legacy_api
v1_dedicated newly created → tenant_schema
v2_shared → tenant_schema
migrated v2→v1 → tenant_schema
```

---

# Catalog additions

Preferred explicit fields:

```ts
api_schema_name: text
api_schema_strategy: "legacy_api" | "tenant_schema"
tenant_id: uuid
```

Examples:

```txt
old v1:
  mode = v1_dedicated
  api_schema_name = api
  api_schema_strategy = legacy_api

new v1:
  mode = v1_dedicated
  api_schema_name = t_ab12cd34ef56_api
  api_schema_strategy = tenant_schema

v2:
  mode = v2_shared
  api_schema_name = t_ab12cd34ef56_api
  api_schema_strategy = tenant_schema
```

If you want fewer DB changes, derive it for now — but explicit catalog fields will make migration safer.

---

# Build phase 1: schema identity helpers

Create one canonical helper, shared everywhere:

```ts
deriveTenantApiSchema(project): string
```

Behavior:

```txt
if project.api_schema_name exists:
  return project.api_schema_name

if project.mode === v2_shared:
  return t_<shortid>_api

if project.mode === v1_dedicated and strategy === tenant_schema:
  return t_<shortid>_api

else:
  return api
```

Also create:

```ts
isLegacyApiSchemaProject(project): boolean
isTenantSchemaProject(project): boolean
```

Acceptance:

* No route, CLI command, or provisioning code hand-rolls schema names.
* Existing `tenantApiSchemaFromProjectId` becomes a wrapper or is replaced.

---

# Build phase 2: new v1 provisioning

Update v1 provisioning to support:

```ts
apiSchemaName?: string
```

For old/legacy v1:

```txt
api
```

For new v1:

```txt
t_<shortid>_api
```

Dedicated PostgREST config becomes:

```txt
PGRST_DB_SCHEMAS=t_<shortid>_api,public
```

instead of:

```txt
PGRST_DB_SCHEMAS=api,public
```

Bootstrap SQL must create the selected schema.

Do not hardcode `api`.

Acceptance:

* New v1 project boots with `t_<shortid>_api`.
* PostgREST exposes tables from that schema.
* Existing v1 projects still expose `api`.
* `auth.uid()` still works.

---

# Build phase 3: grants and bootstrap refactor

Current constants likely assume `api`.

Refactor:

```ts
buildBootstrapSql({ apiSchemaName })
buildApiSchemaPrivilegesSql({ apiSchemaName })
buildDisableRlsSql({ apiSchemaName })
```

Legacy wrappers can remain:

```ts
BOOTSTRAP_SQL = buildBootstrapSql({ apiSchemaName: "api" })
API_SCHEMA_PRIVILEGES_SQL = buildApiSchemaPrivilegesSql({ apiSchemaName: "api" })
```

Acceptance:

* `api` behavior unchanged for legacy v1.
* `t_<shortid>_api` receives identical grants/default privileges.
* `anon`, `authenticated`, `authenticator`, `auth.uid()` remain consistent.

---

# Build phase 4: CLI push/import awareness

`flux push` must target the project’s canonical schema.

For legacy v1:

```txt
api
```

For new v1 / v2:

```txt
t_<shortid>_api
```

Supabase import behavior needs care.

For legacy v1:

```txt
public → api
```

For tenant-schema v1:

```txt
public → t_<shortid>_api
```

So rename helpers:

```ts
movePublicSchemaObjectsToApi(...)
```

to:

```ts
movePublicSchemaObjectsToTargetSchema(targetSchema)
```

Acceptance:

* `flux push -s` still works for old v1.
* `flux push -s` works for tenant-schema v1.
* v2 pooled push remains unchanged.

---

# Build phase 5: dashboard/API behavior

Dashboard should not display internal schema by default, but it can show it in advanced details.

User-facing copy:

```txt
API schema: managed by Flux
```

Advanced:

```txt
Internal API schema: t_ab12cd34ef56_api
```

Credential/manifest routes should include schema only where useful.

Acceptance:

* Existing v1 dashboard behavior unchanged.
* New v1 does not expose confusing `api` assumptions.
* v2 and new v1 use the same schema naming language internally.

---

# Build phase 6: migration command simplification

`flux migrate v2_shared → v1_dedicated` now does:

```txt
dump source schema t_<shortid>_api
provision dedicated v1 target with same api_schema_name
restore dump without schema rewrite
validate
switch mode/routing
retain source
```

No `t_<shortid>_api → api` transform required.

Still needed:

* owner/grant cleanup
* role compatibility
* PostgREST config
* sequence validation
* row counts
* cache reload

Acceptance:

* Dump restores without schema-name transform.
* JWT secret can be preserved.
* **API URL is preserved** — the same flattened `api--<slug>--<hash>.<domain>` origin remains valid before and after migration.
* Source v2 schema remains until cleanup.

---

# Build phase 7: legacy compatibility

Existing v1 projects remain valid.

Detection rules:

```txt
mode = NULL → legacy v1 → api
mode = v1_dedicated + missing api_schema_name → api
mode = v1_dedicated + api_schema_name = api → api
mode = v1_dedicated + api_schema_name starts t_ → tenant_schema
```

Do not auto-migrate existing v1 projects.

Optional future command:

```bash
flux normalize-schema --project old-v1
```

But not now.

---

# Test matrix

## Schema helper tests

* v2 project returns `t_<shortid>_api`
* new v1 returns `t_<shortid>_api`
* old v1 returns `api`
* null mode returns `api`
* explicit catalog schema wins

## v1 provisioning tests

* legacy v1 creates `api`
* new v1 creates `t_<shortid>_api`
* PostgREST env uses correct `PGRST_DB_SCHEMAS`
* bootstrap SQL uses target schema

## import tests

* Supabase public objects move to `api` for legacy
* Supabase public objects move to `t_<shortid>_api` for tenant-schema v1
* grants apply to target schema

## migration tests

* v2 source schema name equals target v1 schema name
* no schema rewrite occurs
* validation fails before switch if restore fails
* source remains after failure
* project switches only after validation

---

# Rollout order

## Commit 1

Add schema strategy helpers + tests.

## Commit 2

Refactor bootstrap/grant SQL builders to accept schema name.

## Commit 3

Update new v1 provisioning to use tenant schema, behind a feature flag if desired:

```txt
FLUX_V1_TENANT_SCHEMA=true
```

## Commit 4

Update CLI push/import path to target canonical schema.

## Commit 5

Update dashboard copy / advanced schema display.

## Commit 6

Implement `flux migrate` using mirrored schema model.

---

# Recommended feature flag

Use a temporary flag:

```txt
FLUX_V1_TENANT_SCHEMA=true
```

Default recommendation:

```txt
development: true
production: false until tested
```

Eventually remove it and make tenant schema the default for all new v1 projects.

---

# Non-goals

Do not:

* rewrite existing v1 schemas automatically
* expose tenant schema as the main user concept
* support zero-downtime migration in v0
* implement arbitrary SQL transform for migration v0
* change v2 schema naming

---

# Final contract

Flux supports two historical schema shapes:

```txt
Legacy dedicated:
  v1_dedicated + api

Modern tenant-shaped:
  v1_dedicated + t_<shortid>_api
  v2_shared + t_<shortid>_api
```

Future Flux should be modern tenant-shaped by default.

That makes the lifecycle clean:

```txt
shared → dedicated
same tenant id
same schema
same JWT secret
same app contract
```

This is the right architecture.
