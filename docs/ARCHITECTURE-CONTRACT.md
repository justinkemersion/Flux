# Flux Architecture Contract

This contract defines module ownership across the Flux monorepo and the small set of structural rules that the `check:architecture` guardrail enforces. It is the tie-breaker when reviewers disagree about where new code belongs.

## Module ownership

### `@flux/core` (`packages/core`)

Pure, dependency-light building blocks for tenant infrastructure. No HTTP servers, no CLI parsing, no React.

- `projects/` — orchestration: provisioning, nuking, listing tenants.
- `docker/` — Docker names, clients, resource limits, container/network primitives.
- `database/` — Postgres bootstrap, dump import, internal SQL exec.
- `traefik/` — routing labels, CORS, host rules.
- `runtime/` — shared runtime context and cross-cutting classification.
- Schema strategy and tenant URL helpers live as top-level files (`api-schema-strategy.ts`, `tenant-catalog-urls.ts`, etc.) until they earn a folder.

### `@flux/cli` (`packages/cli`)

The `flux` CLI binary. Owns terminal UX and dashboard API transport — never reaches into Docker or Postgres directly.

- `index.ts` — CLI entrypoint only (process wiring, `commander` bootstrap).
- `commands/` — Commander command registration.
- `cli-handlers.ts` — command behavior glue.
- `api-client/` — typed transport against the dashboard API.
- `output/` — terminal formatting and error printing.
- `utils/cli-timestamp.ts` — **CLI timestamp contract** (see below).

#### CLI timestamps

Any **human-facing** CLI output that shows a point in time must use `CliTimestamp` / `formatCliTimestampDisplay` from `utils/cli-timestamp.ts` — not raw ISO strings, `Date#toISOString()`, or ad-hoc locale formatting.

Canonical display line (four segments):

```text
{unixMs} · {isoUtc} · {humanUtc} · {relative}
```

Example:

```text
1781975913697 · 2026-06-20T17:18:33.697Z · Jun 20, 2026, 5:18 PM UTC · 2 days ago
```

- **`unixMs`** — Unix epoch milliseconds (portable machine form).
- **`isoUtc`** — UTC ISO 8601 from the API wire format (preserved for scripts and logs).
- **`humanUtc`** — absolute UTC label for operators.
- **`relative`** — relative phrase (`2 days ago`, `just now`, …).

JSON/machine output paths (gauntlet `--json`, API payloads) keep raw ISO strings; only terminal copy uses this formatter.

### `dashboard` (`apps/dashboard`)

Next.js control plane.

- Route handlers own HTTP, auth, and response shape.
- `src/lib/projects/` — dashboard-side project actions.
- `src/lib/db/` — system catalog/database access.
- `src/lib/db/system-db-bootstrap.ts` — migration-sensitive; must remain idempotent.
- React components live under `src/components/` and stay free of orchestration logic.

### Other workspaces

- `@flux/sdk` — public PostgREST client surface; stays small and dependency-light.
- `@flux/engine-v1` / `@flux/engine-v2` — runtime mode adapters; do not reach across each other.
- `@flux/gateway` — request routing and JWT bridge.
- `@flux/migrate` — migration runner.

## Public API rule

- `packages/core/src/index.ts` is **public re-exports only**. No implementation, no top-level constants, no helpers — only `export ... from "./..."` and `export type ... from "./..."`. New behavior goes in a sibling module and is then re-exported.
- `packages/cli/src/index.ts` is the **CLI entrypoint only**. It wires `process` handlers, hydrates env, and hands off to `registerFluxCliCommands`. New command logic belongs in `commands/`, `cli-handlers.ts`, or `output/` — not here.
- Package subpath exports declared in each `package.json` are compatibility contracts; treat additions as semver-meaningful.

### Dashboard client bundle and `@flux/core`

Next.js client components must **not** import the **`@flux/core` root barrel**. That entry re-exports `ProjectManager`, dockerode, and other Node-only modules — the production dashboard build will fail (e.g. `node:fs/promises` in client chunks).

**Rule (enforced by `check:architecture`):** any file in `apps/dashboard` that contains `"use client"`, plus `apps/dashboard/src/lib/project-db-access-copy.ts`, may import `@flux/core` **only** via these browser-safe subpaths:

| Subpath | Typical client use |
|---------|-------------------|
| `@flux/core/api-schema-strategy` | Tenant schema name helpers |
| `@flux/core/backup-policy` | Backup freshness labels |
| `@flux/core/backup-trust` | Backup gate types / client helpers |
| `@flux/core/database-access-gui` | Private DB access GUI copy (labels + field order) |
| `@flux/core/standalone` | URL helpers, `buildFluxAppDotEnvSnippet`, summary types |

Server routes and `apps/dashboard/src/lib/*` (except client-boundary copy modules) may import `@flux/core` freely. When adding a new subpath for client use, ensure the module has **no** transitive imports of dockerode, `node:fs`, or `ProjectManager`, then add the subpath to `DASHBOARD_CLIENT_SAFE_CORE_SUBPATHS` in `scripts/check-architecture.ts` and this table.

## v1_dedicated vs v2_shared seam

- v1 (dedicated stack per project) and v2 (pooled, shared schema-per-tenant) are independent runtime modes. Code that knows about both lives behind helpers in `@flux/core` (`runtime-modes.ts`, `api-schema-strategy.ts`) — not duplicated in app/dashboard call sites.
- Do not let v2-only assumptions (e.g. shared schema names) leak into v1 paths or vice versa. When in doubt, branch on `FluxCatalogProjectMode`.

## No junk-drawer rule

`check:architecture` fails on new source files named:

- `utils.ts`
- `helpers.ts`
- `misc.ts`
- `common.ts`

These names do not say what changes when the file changes. Pick a name by reason to change instead — `env-file.ts`, `tenant-suffix.ts`, `terminal.ts`. If a file genuinely needs an exception, add it to the allowlist in `scripts/check-architecture.ts` with a comment explaining why.

## File size warning

Source files over 800 lines emit a warning (not a failure). Treat the warning as a prompt to split by responsibility on the next change that touches the file.

## Where to put new code (quick guide)

- New Docker primitive → `packages/core/src/docker/` and re-export from `index.ts`.
- New tenant URL helper → `packages/core/src/tenant-catalog-urls.ts` (or sibling), then re-export.
- New CLI command → `packages/cli/src/commands/` plus a handler in `cli-handlers.ts`.
- New dashboard API call from CLI → `packages/cli/src/api-client/<domain>.ts`.
- New dashboard route → `apps/dashboard/app/.../route.ts` with logic delegated to `src/lib/...`.
