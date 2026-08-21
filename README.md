# Flux

**Flux** is a self-hosted **PostgreSQL + PostgREST backend control plane** for running many tenant projects on your own infrastructure. It provisions isolated databases and instant REST APIs, tracks them in a central catalog, and gives operators a **CLI-first, dashboard-assisted** toolkit to migrate, back up, inspect, and lifecycle-manage those backends.

Flux is not a thin Supabase clone. It is a **database/application backend platform** with two runtime modes, a pooled edge gateway, restore-verified destructive gates, private database access without exposing Postgres to the internet, and an **AI-assistable MCP interface** so coding agents can understand and operate projects safely.

**Who it is for:**

| Audience | Use Flux for |
|----------|--------------|
| **Operators** | Provision and run many tenant backends on Docker; deploy v2 shared pool + gateway + dashboard; backups, audits, lifecycle |
| **App developers** | PostgREST APIs, SQL migrations, JWT + RLS; integrate Next.js, Auth.js, Clerk, etc. |
| **AI coding agents** | Scoped MCP tools over the same control plane as the CLI — schema inspection, migration planning, backup-gated apply |
| **Future you** | One repo that documents how dedicated and pooled runtimes actually behave in production |

**Why Flux instead of only Supabase or raw Docker/Postgres:**

- **Self-hosted control** — your Docker host, your catalog DB (`flux-system`), your backup volumes; no mandatory managed platform.
- **Two engines, one catalog** — **`v1_dedicated`** (full isolation per project) and **`v2_shared`** (cost-efficient pooled tenants) without rewriting your app model.
- **Operator discipline built in** — restore-verified backups before destructive actions, SSH-tunneled DB access, ops audit scripts, deploy ordering.
- **Agent-native** — MCP v0 exposes read/plan/controlled-apply tools with capability-scoped tokens; destructive lifecycle remains CLI/dashboard-only.

### Runtime modes (plain terms)

| Mode | What you get | Typical use |
|------|----------------|-------------|
| **`v1_dedicated`** | One **PostgreSQL** container + one **PostgREST** container per project; Traefik routes `api--<slug>--<hash>.<domain>` to that stack | Strong isolation, legacy stacks, `flux migrate` destination |
| **`v2_shared`** | Schema + role per tenant on a **shared Postgres cluster**; **one PostgREST pool** behind **`@flux/gateway`**; gateway mints bridge JWTs and injects schema profile headers | Default for new Hobby/Free-tier projects; lower ops overhead per tenant |

New users on the hosted product often start on **`v2_shared`**. **`v1_dedicated`** is available when you need dedicated containers and volumes.

---

## Table of contents

1. [What Flux is](#what-flux-is)
2. [Current platform capabilities](#current-platform-capabilities)
3. [Runtime architecture](#runtime-architecture)
4. [Repository map](#repository-map)
5. [Core workflows](#core-workflows)
6. [CLI reference](#cli-reference)
7. [MCP and AI-assistant integration](#mcp-and-ai-assistant-integration)
8. [Dashboard](#dashboard)
9. [Security and operations](#security-and-operations)
10. [Production deployment](#production-deployment)
11. [Documentation map](#documentation-map)
12. [Roadmap and trajectory](#roadmap-and-trajectory)
13. [Documentation maintenance contract](#documentation-maintenance-contract)

---

## What Flux is

Flux combines:

- **Control plane** — `@flux/cli`, `apps/dashboard`, and `@flux/mcp` call a Bearer API (`/api/cli/v1/*`) backed by **`flux-system`** Postgres and Docker orchestration (`@flux/core`, `@flux/engine-v2`).
- **Data plane** — Tenant **Postgres** + **PostgREST** (v1 per project, v2 pooled). Application traffic hits PostgREST through Traefik (v1) or the Node gateway (v2), not the Next.js app.
- **Product posture** — CLI-first; dashboard removes blockers and explains state ([`docs/UI-SCOPE-CONTRACT.md`](docs/UI-SCOPE-CONTRACT.md)). Flux is not a full database IDE or Supabase Studio clone.

**Stack (typical versions in tree):** Node.js 20+, TypeScript 5–6 (strict), pnpm 10.x, Next.js 16 + React 19 (dashboard), Auth.js v5 beta, Drizzle + `pg`, dockerode, Commander (CLI).

---

## Current platform capabilities

Grouped by area. Status labels: **stable**, **beta**, **operator-only**, **trajectory** (planned / not fully implemented).

| Area | Capability | Status |
|------|------------|--------|
| **Provisioning** | `flux create` / dashboard create — `v1_dedicated` or `v2_shared`; `flux init` links Foundry repos; `flux list` prints slug, hash, mode, canonical Service URL | stable |
| **Runtime modes** | `v1_dedicated` (per-tenant containers) vs `v2_shared` (pooled schema + role); `flux migrate` v2→v1 | stable |
| **SQL & migrations** | `flux push` — file or `migrations/` directory; `--mode raw\|versioned\|repeatable`, `--plan`, `--dry-run`; tenant-scoped ledger `flux.flux_migrations (tenant_schema, version)` on v2; Supabase-compat import | stable |
| **Backups** | `flux backup create \| list \| verify \| download` — v1 full DB; v2 tenant schema export; optional R2 offsite (`FLUX_R2_BACKUPS_*`); platform scheduler (`FLUX_MIN_BACKUP_*`) | stable |
| **Restore verification / destructive gates** | Newest backup must be **restore-verified** before `flux nuke`, `flux migrate`, `flux db-reset`, `flux db restore`, dashboard Delete / Factory reset — unless explicit override (`--skip-backup-check` / `?skipBackupCheck=true`); `@flux/core/backup-trust` | stable |
| **Private database access** | `flux db tunnel \| shell \| dump \| restore \| password \| access-plan \| gui-config` — SSH tunnel; v1: project `postgres` password; v2: temporary scoped roles (readonly default); pooled admin never exposed | stable |
| **Schema inspection** | `flux db inspect \| tables \| describe \| counts`; dashboard Schema Explorer; `@flux/core/schema-inspection` | stable |
| **Project doctor / understanding** | `flux doctor`, activity timeline, portfolio views, `flux project lifecycle` | stable |
| **FLUX.md project briefs** | `flux project brief push \| generate \| prompt \| clear`; dashboard brief panel | stable |
| **AI summaries / assistant** | `flux project summarize` (Workers AI when configured); dashboard Generate draft | stable (host-dependent) |
| **MCP / assistant interface** | `@flux/mcp` stdio server; 14 tools, resources, prompts; scoped `flx_mcp_` tokens; backup-gated `flux.migration.apply` | **beta (v0)** — see [MCP section](#mcp-and-ai-assistant-integration) |
| **Dashboard** | GitHub OAuth, projects, schema explorer, DB access panel, backup trust UI, docs at `/docs`, MCP token settings, Stripe hooks | stable |
| **Gateway** | `@flux/gateway` — host routing, project JWT verify, bridge JWT mint, rate limits, profile headers, lifecycle 503 | stable |
| **v2_shared / Hobby tier** | Default pooled provisioning; **2 active project cap** on Hobby (`project-lifecycle-state`); tier-aware per-tenant rate limits | stable (limits) / **trajectory** (per-plan gateway rate limits) |
| **Lifecycle / sleep / archive / reap** | `flux project wake \| sleep \| archive`; `flux reap`; dormant/archived → gateway 503 | stable |
| **Observability / ops audit** | `flux logs` (v1); fleet monitor + JWT deep probes (v2); `bin/ops-audit.sh` | stable |
| **Deploy workflow** | `deploy-traefik` → `deploy-v2-shared` → `deploy-gateway` → `deploy-web`; `bin/launch-web.sh` for dashboard-only releases | operator-only |
| **Security posture** | Gateway Bearer (v2), migration ledger isolation, backup trust, MCP route allowlist, Docker socket risk documented | stable |

Canonical user docs (when deployed): **`https://flux.vsl-base.com/docs/`** — source in [`docs/pages/`](docs/pages/).

---

## Runtime architecture

### Control plane vs data plane

| Layer | Components | Role |
|-------|------------|------|
| **Control plane** | CLI, dashboard, MCP server | Catalog, provisioning, backups, migrations API, auth; connects to `flux-system` and Docker API |
| **Data plane** | Postgres, PostgREST, gateway | Serves tenant HTTP/SQL; app clients call tenant API URLs |

Postgres for tenant data is **not** published on the public internet. Operators reach databases via SSH tunnels (`flux db tunnel`) or temporary v2 roles.

### v1_dedicated topology

```
Client → Traefik (flux-gateway) → flux-<hash>-<slug>-api (PostgREST) → flux-<hash>-<slug>-db (Postgres)
```

- Per-project **internal** network `flux-<hash>-<slug>-net` isolates Postgres.
- PostgREST attaches to `flux-network` for Traefik routing.
- Bootstrap SQL creates `api` + `auth` schemas, `auth.uid()`, JWT roles.
- Dedicated PostgREST is reached directly through Traefik; there is no Flux gateway authentication layer in front of it. RLS plus grants are the request-time authorization boundary for every exposed API table.
- `flux push` audits effective PostgREST privileges inside the same transaction as user SQL. It rolls the push back if an exposed table has RLS disabled **and** `anon`, `authenticated`, or `PUBLIC` can write. Read-only RLS-disabled exposure and RLS-without-policies are warnings, not migration failures.
- Schema changes: `NOTIFY pgrst, 'reload schema'` + SIGUSR1 to PostgREST after a successful `flux push`.

### v2_shared topology

```
Client → flux-node-gateway → postgrest-pool → pgbouncer → postgres-v2 (many t_<shortId>_api schemas)
```

| Component | Container (typical) | Role |
|-----------|---------------------|------|
| Shared Postgres | `flux-postgres-v2` | All tenant schemas + roles |
| Pooler | `flux-pgbouncer` | Transaction pooling |
| PostgREST pool | `flux-postgrest-pool` | Shared PostgREST |
| Edge gateway | `flux-node-gateway` | Tenant resolve, JWT, rate limit, proxy |
| Control plane | `flux-web` | Catalog, CLI API, dashboard |

Compose: [`docker/traefik/docker-compose.yml`](docker/traefik/docker-compose.yml), [`docker/v2-shared/docker-compose.yml`](docker/v2-shared/docker-compose.yml), [`packages/gateway`](packages/gateway), [`docker/web/docker-compose.yml`](docker/web/docker-compose.yml). The control plane reconciles one exact-host TLS router per pooled catalog project into Traefik's watched `flux-traefik-dynamic` volume. New v2 Service URLs therefore enter ACME certificate discovery automatically; project deletion and v2→v1 cutover remove the pooled router, and startup reconciliation heals missed lifecycle events.

### JWT and schema isolation (v2 summary)

1. Gateway resolves host → tenant (`api--<slug>--<hash>.<domain>` or custom domain).
2. Gateway verifies client **project Bearer JWT** (HS256, per-project `jwt_secret`).
3. Gateway mints short-lived **bridge JWT** (`role: t_<shortId>_role`, `sub` for RLS).
4. Gateway injects `Accept-Profile` / `Content-Profile: t_<shortId>_api` on upstream PostgREST.
5. PostgREST hooks (`flux_postgrest_config`, `flux_set_tenant_context`) set `search_path` and timeouts per request.

**Deep dive:** [`docs/pages/architecture/flux-v2-architecture.md`](docs/pages/architecture/flux-v2-architecture.md), [`docs/pages/architecture/bridge-jwts.md`](docs/pages/architecture/bridge-jwts.md).

### Tenant schema and role isolation (v2)

- Schema: `t_<shortId>_api` — tables, policies, grants for the tenant.
- Role: `t_<shortId>_role` — JWT `role` claim on v2_shared (not `authenticated`). Runtime only: it owns nothing and cannot run DDL.
- Owner role: `t_<shortId>_ddl` — `NOLOGIN`, owns the schema and everything pushed into it. Pooled `flux push` runs DDL as this role via `SET LOCAL ROLE`. Keeping the owner distinct from the runtime role is what keeps RLS in force, since a table owner bypasses RLS; pushes additionally apply `FORCE ROW LEVEL SECURITY` to RLS-enabled tenant tables and abort if the runtime role is found owning anything.
- Provisioned by `@flux/engine-v2`; collision guard via schema `COMMENT` ownership marker.
- Operator checks: `bin/pass6b-reconcile-tenant-roles.sh` (read-only) and `bin/pass6b-backfill-tenant-ddl-roles.sh` (idempotent backfill for tenants provisioned before the owner role existed).

### Why Postgres is not publicly exposed

- Reduces attack surface; RLS and grants are not a substitute for network exposure control.
- v2 pooled admin credentials never leave the platform; operators use **temporary readonly roles** scoped to one tenant schema.
- Private access path: SSH bastion → local tunnel → Docker-internal DB host ([`docs/pages/guides/database-access.md`](docs/pages/guides/database-access.md)).

### Dashboard mode-split (operator detail)

v1 and v2 projects differ in which API routes touch Docker. Full route matrix: [`docs/OPERATOR-DASHBOARD-MODE-SPLIT.md`](docs/OPERATOR-DASHBOARD-MODE-SPLIT.md).

---

## Repository map

Monorepo: [`pnpm-workspace.yaml`](pnpm-workspace.yaml) (`packages/*`, `apps/*`).

| Path | Package / role |
|------|----------------|
| [`packages/core`](packages/core) | `@flux/core` — ProjectManager, Docker v1, backups, backup-trust, schema-inspection, lifecycle, MCP contracts, SQL migrations |
| [`packages/cli`](packages/cli) | `@flux/cli` — `flux` CLI (Commander) |
| [`packages/sdk`](packages/sdk) | `@flux/sdk` — PostgREST-shaped TypeScript client |
| [`packages/engine-v2`](packages/engine-v2) | `@flux/engine-v2` — v2_shared Postgres provisioning, temp DB access roles |
| [`packages/engine-v1`](packages/engine-v1) | `@flux/engine-v1` — v1 dedicated execution strategy |
| [`packages/gateway`](packages/gateway) | `@flux/gateway` — Node edge gateway (`flux-node-gateway`) |
| [`packages/mcp`](packages/mcp) | `@flux/mcp` — MCP stdio server for AI agents |
| [`packages/migrate`](packages/migrate) | `@flux/migrate` — v2→v1 migration helpers |
| [`apps/dashboard`](apps/dashboard) | Next.js control-plane UI + `/api/cli/v1/*` + MCP token management |
| [`docs/pages`](docs/pages) | Rendered product docs (dashboard `/docs/*`) |
| [`docs/guides`](docs/guides) | Standalone guides (import, v1 SQL workflows) — some mirrored under `docs/pages/guides/` |
| [`bin`](bin) | Deploy, ops-audit, smoke, ledger migration scripts |
| [`plans`](plans) | Security passes, MCP phases, backups, dashboard IA |
| [`AGENTS.md`](AGENTS.md) | **External** v2_shared app developer footguns |
| [`docs/TRAJECTORY-TODO.md`](docs/TRAJECTORY-TODO.md) | Internal engineering backlog |
| [`docs/README-MAINTENANCE-CONTRACT.md`](docs/README-MAINTENANCE-CONTRACT.md) | Documentation freshness policy |

Root scripts: [`package.json`](package.json) — `pnpm typecheck`, `pnpm test`, `pnpm check:architecture`, `pnpm flux`.

---

## Core workflows

### Install / bootstrap

```bash
git clone <repo-url>
cd flux
pnpm install
pnpm run flux -- --help
```

**Prerequisites:** Node.js 20+, pnpm, Docker Engine (socket or `DOCKER_HOST`).

### CLI login / whoami

```bash
flux login          # paste API key from dashboard (shown once at creation)
flux login --refresh
flux whoami
```

API keys: dashboard only. Operator mode is quiet by default; `FLUX_CLI_VERBOSE=1` for advisories. Admins: `FLUX_CLI_ADMIN_EMAILS` in dashboard env.

### Create a project

```bash
flux create my-app --mode v2_shared    # or v1_dedicated
# Or from a repo with flux.json:
flux init
```

Dashboard: `/projects` → Create (GitHub sign-in required on hosted).

### Push SQL / migrations

```bash
flux push ./migrations/ -p my-app --hash <7hex> --plan
flux push ./migrations/ -p my-app --hash <7hex>
flux migrations list -p my-app --hash <7hex>
```

v2 directory push uses tenant-scoped ledger. Legacy global ledger: [`bin/migrate-pooled-ledger.sh`](bin/migrate-pooled-ledger.sh).

**Foundry-style pooled push:** Pooled SQL executes under `SET LOCAL ROLE t_<shortId>_role` with `search_path` set to `t_<shortId>_api`, so unqualified DDL lands in the tenant schema and runs with tenant privileges. `GRANT … TO authenticated` and `ON SCHEMA public` are rewritten at execution to the tenant role/schema (checksums use file content); qualified `public.<object>` references are left intact. The rewrite is lexical — comments, string literals, quoted identifiers and dollar-quoted bodies are never touched, so dynamic SQL such as `EXECUTE format('grant authenticated to %I', r)` must resolve the tenant role itself. See [bridge JWTs](docs/pages/architecture/bridge-jwts.md) for the full adaptation contract. Gateway maps app JWT `role: authenticated` → `t_<shortId>_role`. Unauthenticated API calls fail closed with HTTP **401** `{ "error": "authorization required" }`.

### Inspect DB / schema

```bash
flux db inspect -p my-app --hash <7hex>
flux db tables -p my-app --hash <7hex>
flux db describe notes -p my-app --hash <7hex>
flux doctor -p my-app --hash <7hex>
```

### Open private DB access

```bash
flux db access-plan -p my-app --hash <7hex>
flux db tunnel -p my-app --hash <7hex>    # v2: creates temp readonly role
flux db password -p my-app --hash <7hex>  # v1 only
```

Configure bastion: `FLUX_DB_TUNNEL_SSH_HOST` on `flux-web`. Guide: [`docs/pages/guides/database-access.md`](docs/pages/guides/database-access.md).

### Create and verify backup

```bash
flux backup create -p my-app --hash <7hex>
flux backup verify -p my-app --hash <7hex> --latest
flux backup list -p my-app --hash <7hex>
```

### Run destructive operation safely

1. `flux backup create` → `flux backup verify --latest`
2. Confirm trust is **restorable** (`flux backup list` or dashboard Database tools)
3. Then: `flux nuke`, `flux migrate`, `flux db-reset`, dashboard Delete — or override with `--skip-backup-check` / `?skipBackupCheck=true` when you accept the risk

### Wake / sleep / archive / reap

```bash
flux project sleep -p my-app --hash <7hex>
flux project wake -p my-app --hash <7hex>
flux project archive -p my-app --hash <7hex>
flux project lifecycle -p my-app --hash <7hex>
flux reap --hours 72
```

### Project brief (FLUX.md)

```bash
flux project brief push -p my-app --hash <7hex>
flux project brief generate --save -p my-app --hash <7hex>
flux project summarize --kind activity -p my-app --hash <7hex>
```

### Use MCP / assistant tooling

See [MCP and AI-assistant integration](#mcp-and-ai-assistant-integration). Quick start: create token at `/settings/mcp-tokens`, configure Cursor, run `flux mcp doctor`.

### Deploy Flux (operator)

On server (canonical order):

```bash
./bin/deploy-traefik.sh
./bin/deploy-v2-shared.sh
./bin/deploy-gateway.sh
./bin/deploy-web.sh
# or:
./bin/deploy-all.sh
```

From laptop (dashboard only): `./bin/launch-web.sh --commit "..."`. See [Production deployment](#production-deployment).

### Run ops audit

```bash
./bin/ops-audit.sh --remote
./bin/ops-audit.sh --remote --deep --smoke
```

---

## CLI reference

Authoritative flags: `flux --help` and subcommand help. Implementation: [`packages/cli/src/commands/register-cli/`](packages/cli/src/commands/register-cli/).

### Command tree

```
flux
├── update
├── login [--refresh]
├── whoami
├── init [--slug] [--mode] [--yes] [--no-supabase-rest-path]
├── create <name> [--mode] [--hash] [--no-supabase-rest-path]
├── push [target] …
├── migrations list …
├── migrate …                    # v2_shared → v1_dedicated (destructive; backup gate)
├── db-reset …                   # backup gate
├── supabase-rest-path …
├── cors …
├── gauntlet run | matrix | inspect-schema …
├── list | open | logs | dump
├── backup create | list | download | verify
├── db access-plan | gui-config | password | tunnel | shell | dump | restore
│      inspect | tables | describe | counts
├── keys | stop | start | nuke    # nuke: backup gate
├── reap --hours <n>
├── env set | list
├── doctor | activity
├── project credentials | doctor | activity | metadata | brief | summarize
│         wake | sleep | archive | lifecycle
└── mcp doctor [--base]
```

### Backup-gated destructive commands

| Command | Override |
|---------|----------|
| `flux nuke` | `--skip-backup-check` (skipped when `--force` orphan purge) |
| `flux migrate` | `--skip-backup-check` (not when `--dry-run`) |
| `flux db-reset` | `--skip-backup-check` |
| `flux db restore` | `--skip-backup-check` |

Requires `-y` / `--yes` or explicit overwrite flags as documented in help.

### Private database access (summary)

| Command | v1_dedicated | v2_shared |
|---------|-------------|-----------|
| `flux db tunnel` | Tunnel + use `flux db password` | Tunnel + temp readonly creds (one-time password) |
| `flux db restore` | Supported (backup gate) | **Refused** for pooled production schemas |
| `flux db password` | Prints postgres password | Error — use tunnel temp creds |

Full tables and Beekeeper notes: [`docs/pages/guides/database-access.md`](docs/pages/guides/database-access.md).

### Examples

```bash
pnpm run flux -- create "ACME Corp"
pnpm run flux -- push ./migrations/ --project "ACME Corp"
pnpm run flux -- backup create --project "ACME Corp" --hash abc1234
pnpm run flux -- backup verify --project "ACME Corp" --hash abc1234 --latest
pnpm run flux -- db inspect --project "ACME Corp" --hash abc1234
```

Rendered CLI reference: [`docs/pages/reference/cli.md`](docs/pages/reference/cli.md).

---

## MCP and AI-assistant integration

Flux exposes the **same control plane** as the CLI and dashboard to AI coding tools via [Model Context Protocol](https://modelcontextprotocol.io) (MCP). Package: [`@flux/mcp`](packages/mcp) (`packages/mcp`).

### Status (honest labels)

| Aspect | Status |
|--------|--------|
| **`@flux/mcp` overall** | **v0 / beta** (contract `0.1.0`) |
| **stdio transport** | **Shipped** — primary integration path |
| **HTTP MCP transport** | **Deferred** — not implemented |
| **Dashboard approval UI** for agent actions | **Deferred** — intents are recorded, not human-gated |
| **Destructive lifecycle** (nuke, delete, factory reset, db-reset, restore, migrate, raw push) | **Blocked** — never in MCP `tools/list` |
| **`flux.migration.apply`** | **Controlled** — capability-gated; requires prior plan + restore-verified backup |
| **`flux.backup.ensureVerified`** | **Controlled** — protective mutation; no `skipBackupCheck` |
| **Legacy `FLUX_API_TOKEN` / `flx_live_` for MCP** | **Temporary / deprecated path** — stderr warning; use scoped `FLUX_MCP_TOKEN`; `flux mcp doctor` requires `flx_mcp_` token |

### Purpose

Let Cursor, Codex, Claude Code, Windsurf, and other MCP clients **safely understand and operate** Flux projects: list/describe projects, inspect schema, plan migrations, optionally apply planned migrations after backup verification — without pooled admin credentials, long-lived JWT secrets, or unaudited destructive commands.

### What the MCP server exposes

**Start (stdio):**

```bash
pnpm --filter @flux/mcp build
# Cursor / MCP client:
# command: node
# args: ["/path/to/flux/packages/mcp/dist/index.cjs"]
# env: FLUX_MCP_TOKEN=flx_mcp_..., FLUX_API_BASE=https://flux.vsl-base.com/api
```

**Tools (14):**

| Tool | Class | Capability (typical) |
|------|-------|----------------------|
| `flux.project.list` | read | `project:read` |
| `flux.project.describe` | read | `project:read` |
| `flux.schema.inspect` | read | `schema:read` |
| `flux.schema.counts` | read | `schema:read` |
| `flux.migrations.list` | read | `schema:read` |
| `flux.doctor` | read | `project:read` |
| `flux.activity` | read | `activity:read` |
| `flux.backup.list` | read | `backup:read` |
| `flux.destructive.preflight` | preflight | `backup:read` |
| `flux.migration.plan` | plan | `migration:plan` |
| `flux.query.readonly` | read | `query:readonly` (v2 only) |
| `flux.credentials.temporary` | credential | `query:readonly` (v2 only) |
| `flux.backup.ensureVerified` | protective mutation | `backup:ensure_verified` |
| `flux.migration.apply` | write | `migration:apply` |

**Resources:** `flux://projects`, per-hash schema/backups/activity/doctor, bundled guide markdown.

**Prompts (6):** production readiness, migration review, RLS debug, nextjs setup, backup-before-migration, brief refresh.

**CLI parity:** `flux mcp doctor [--base]` — validates token, `auth/verify`, contract version.

### Capability presets (dashboard)

| Preset | Use |
|--------|-----|
| Read-only observer | Default exploration — list, schema, backups, activity |
| Migration planner | Adds `flux.migration.plan` |
| Read-only data inspector | Adds `flux.query.readonly`, temp readonly creds |
| Controlled migration applier | Adds backup ensure + `flux.migration.apply` (shorter expiry) |

Create tokens: dashboard **Settings → MCP tokens** (`/settings/mcp-tokens`).

### Safe migration apply loop

```
flux.migration.plan → flux.backup.ensureVerified → flux.destructive.preflight → flux.migration.apply
```

Requires **Controlled migration applier** preset (or equivalent capabilities). Plans are stored in-memory in the MCP process — **re-plan after MCP restart**.

### Safety model

- **Read-only by default** — mutation tools require explicit capabilities on scoped tokens.
- **No secret leakage** — responses omit DB passwords, pooled admin creds, JWT secrets, artifact paths.
- **Server route allowlist** — MCP tokens cannot hit destructive CLI routes (`mcp-route-auth.ts`).
- **Project scope fail-closed** — every project-scoped `/api/cli/v1/projects/:hash/…` route resolves the hash from the path (or explicit input) and rejects out-of-scope projects; missing hash is denied, not skipped.
- **Readonly temp credentials** — MCP tokens with `query:readonly` may mint short-lived **readonly** DB credentials only (HTTP `access: readwrite` is rejected).
- **Audit + intents** — tool calls POST to `/api/cli/v1/audit`; mutations create intents before side effects.
- **No raw SQL write** — apply only runs files from a prior plan via existing `pushSql`.

### Example prompts (Cursor / Codex)

- “Use Flux MCP to list my projects and run `flux.doctor` on hash `abc1234`.”
- “Inspect schema for project `abc1234` and list applied migrations.”
- “Plan `migrations/` for `abc1234`, ensure a verified backup, then apply if preflight passes.”

### Current limitations

- stdio only (no remote MCP endpoint)
- v2 only for `flux.query.readonly` and `flux.credentials.temporary`
- In-memory plan store (lost on MCP restart)
- No MCP exposure for nuke, delete, lifecycle, project create
- Legacy CLI token still accepted by MCP server with warning (not by `flux mcp doctor`)

### Canonical MCP docs

- [`packages/mcp/README.md`](packages/mcp/README.md) — operator setup
- [`docs/pages/guides/mcp.md`](docs/pages/guides/mcp.md) — rendered guide
- [`docs/pages/release-notes/mcp-v0.md`](docs/pages/release-notes/mcp-v0.md) — release notes
- [`docs/AGENT_NATIVE_FLUX.md`](docs/AGENT_NATIVE_FLUX.md) — milestone strategy

Smoke: `./bin/mcp-smoke.sh` (offline); `./bin/mcp-smoke.sh --hosted` with `FLUX_MCP_TOKEN` + `FLUX_MCP_SMOKE_HASH`.

---

## Dashboard

**What it owns** ([`docs/UI-SCOPE-CONTRACT.md`](docs/UI-SCOPE-CONTRACT.md)):

| Area | Features |
|------|----------|
| **Auth** | GitHub OAuth (Auth.js), sessions in `flux-system` |
| **Projects** | List, create, detail, mode-aware cards, lifecycle panel, portfolio views |
| **Schema** | Schema explorer, data preview (bounded) |
| **DB access** | Private Database Access panel — CLI copy, temp cred guidance |
| **Backups** | Create, verify, trust labels, destructive-action UI gates |
| **Understanding** | Doctor, activity timeline, `FLUX.md` brief panel, AI summarize draft |
| **MCP** | Settings → MCP tokens; Agent Activity (`/agent-activity`) |
| **Docs** | Renders [`docs/pages/`](docs/pages/) at `/docs/*` |
| **Billing** | Stripe checkout hooks (application layer; tenant data stays in tenant DBs) |
| **CLI API** | Bearer `/api/cli/v1/*` for `flux login` clients and MCP |

**What it intentionally does not own:** full SQL IDE, arbitrary admin SQL on pooled cluster, Supabase Studio parity, destructive migrate UI (CLI-only for `flux migrate`).

**Stack:** Next.js App Router, Drizzle, `@flux/core` for v1 Docker ops, `@flux/engine-v2` for v2 provisioning. `instrumentation.ts` bootstraps `flux-system` on server start.

---

## Security and operations

| Topic | Posture |
|-------|---------|
| **Docker socket** | Control plane with socket access = host-root equivalent; restrict who runs dashboard/CLI on production hosts |
| **Secrets** | Generated at provision; `flux env list` redacts sensitive keys; never commit `.env*` |
| **Private DB access** | SSH tunnel + v1 password or v2 temp roles; audit events for temp cred issuance (no plaintext password stored) |
| **v2 temp roles** | Readonly default; readwrite requires `FLUX_DB_ACCESS_ALLOW_READWRITE=1` |
| **Backup trust** | Destructive actions require restore-verified newest backup (`@flux/core/backup-trust`) |
| **Destructive gates** | CLI + dashboard + MCP apply path; HTTP 412 when blocked |
| **R2 / offsite backups** | Optional `FLUX_R2_BACKUPS_*` when configured |
| **Ops audit** | `bin/ops-audit.sh` — containers, logs, backup catalog (`--deep`), edge smoke (`--smoke`) |
| **Gateway guardrails** | Rate limit (`FLUX_GATEWAY_RATE_LIMIT`), lifecycle 503, migration drain 503 |
| **Free / Hobby tier** | Default `v2_shared`; max **2 active** projects; tier-aware gateway rate limits per tenant — **trajectory** (single env limit today) |
| **Known deferred** | HTTP MCP, approval UI for agents, formal removal of legacy MCP CLI token |

**Pooled migration ledger:** If `flux push migrations/` fails on legacy global ledger, run [`bin/migrate-pooled-ledger.sh`](bin/migrate-pooled-ledger.sh). Details: [`docs/pages/guides/migrations.md`](docs/pages/guides/migrations.md).

**App developers (v2_shared):** [`AGENTS.md`](AGENTS.md) — triple-dash URLs, `t_<shortId>_api`, JWT role, GRANT + RLS.

---

## Production deployment

**Audience:** operators. **Triage table:** [`docs/OPERATOR-DEPLOY-TRIAGE.md`](docs/OPERATOR-DEPLOY-TRIAGE.md).

### Server layout

Typical checkout: `/srv/platform/flux` (`FLUX_REMOTE_REPO_ROOT`, `APP_DIR` in deploy scripts). Override if your host differs.

### Deploy order

```bash
./bin/deploy-traefik.sh    # edge + watched v2 tenant TLS configuration
./bin/deploy-v2-shared.sh   # Postgres, PgBouncer, PostgREST pool
./bin/deploy-gateway.sh     # flux-node-gateway
./bin/deploy-web.sh         # dashboard + control plane
```

Orchestrator: `./bin/deploy-all.sh` (optional `FLUX_DEPLOY_GIT_SYNC=1`).

### Launch dashboard from laptop

```bash
./bin/launch-web.sh --commit "feat: …" --tag web-YYYY.MM.DD
./bin/launch-web.sh --sync-env-apply --commit "chore: env"
./bin/launch-web.sh --remote-only
```

Override: `FLUX_LAUNCH_REMOTE`, `FLUX_LAUNCH_APP_DIR`, `FLUX_LAUNCH_BRANCH`. Preflight: `pnpm typecheck` + dashboard build unless `--skip-checks`.

**Env sync:** `bin/sync-env-remote.sh` — whitelisted `docker/web/.env`, `packages/gateway/.env`, `docker/v2-shared/.env`.

### Health checks

```bash
curl -fsS http://127.0.0.1:4000/health
curl -fsS http://127.0.0.1:4000/health/deep
```

Set `FLUX_TENANT_PROBE_GATEWAY_URL=http://flux-node-gateway:4000` in `docker/web/.env` for reliable in-container v2 mesh probes.

`docker/web/docker-compose.yml` sets `FLUX_TRAEFIK_DYNAMIC_CONFIG_PATH` and shares the named `flux-traefik-dynamic` volume with Traefik. Do not hand-edit the generated `v2-tenants.yml`; `flux-web` replaces it atomically from the catalog at startup and after pooled create/delete/migration events. The file uses JSON syntax, which is valid YAML, and the `.yml` extension is required for Traefik file-provider discovery. `bin/sync-v2-gateway-tls-domains.sh` remains a legacy rollout fallback, not a normal provisioning step.

### When to run ops audit

- Weekly: `./bin/ops-audit.sh --remote`
- Monthly or after incidents: `--deep --smoke`
- Disk pressure: `bin/ops-disk-inventory.sh`, `bin/ops-cleanup-stale-containers.sh`

---

## Documentation map

| Document | Audience | Notes |
|----------|----------|-------|
| [`README.md`](README.md) | Everyone | Canonical orientation (this file) |
| [`AGENTS.md`](AGENTS.md) | External app devs | v2_shared client footguns |
| [`docs/pages/`](docs/pages/) | App devs, operators | Rendered at `/docs/*` on dashboard |
| [`docs/pages/guides/mcp.md`](docs/pages/guides/mcp.md) | Agent users | MCP setup |
| [`docs/pages/architecture/flux-v2-architecture.md`](docs/pages/architecture/flux-v2-architecture.md) | Operators, agents | Deepest v2 spec |
| [`docs/guides/`](docs/guides/) | Operators | Import, v1 SQL workflows (some duplicated in pages) |
| [`docs/OPERATOR-DASHBOARD-MODE-SPLIT.md`](docs/OPERATOR-DASHBOARD-MODE-SPLIT.md) | Operators | Dashboard v1/v2 API matrix |
| [`docs/OPERATOR-DEPLOY-TRIAGE.md`](docs/OPERATOR-DEPLOY-TRIAGE.md) | Operators | Deploy failure triage |
| [`docs/TRAJECTORY-TODO.md`](docs/TRAJECTORY-TODO.md) | Internal | Engineering backlog |
| [`docs/UI-SCOPE-CONTRACT.md`](docs/UI-SCOPE-CONTRACT.md) | Contributors | Dashboard scope |
| [`docs/README-MAINTENANCE-CONTRACT.md`](docs/README-MAINTENANCE-CONTRACT.md) | Contributors, agents | Docs freshness policy |
| [`docs/AGENT_NATIVE_FLUX.md`](docs/AGENT_NATIVE_FLUX.md) | Internal | MCP/agent strategy |
| [`plans/security/CURRENT.md`](plans/security/CURRENT.md) | Operators | Security pass status |
| [`packages/mcp/README.md`](packages/mcp/README.md) | Agent operators | MCP package setup |

---

## Roadmap and trajectory

Active direction (details and priorities in [`docs/TRAJECTORY-TODO.md`](docs/TRAJECTORY-TODO.md)):

- **MCP / assistant interface** — v0 shipped; HTTP transport, approval UI, merged audit timeline deferred
- **Free pool / Hobby hardening** — active project caps shipped; per-tier gateway limits and pool sharding — trajectory
- **Project understanding** — schema inspection, doctor, FLUX.md, summarize — ongoing maturity
- **Backup / offsite policy** — R2 optional; empty-tenant verify tier — in backlog
- **App/backend generation** — Maker platform roadmap (`docs/MAKER-PLATFORM-ROADMAP.md`)
- **Docs consistency** — IA contract under `docs/_contract/`; this README + maintenance contract
- **Dashboard maturity** — mode-aware UI, backup trust, MCP tokens — ongoing

Do not treat this section as a full backlog — see **TRAJECTORY-TODO** for ranked work items.

---

## Documentation maintenance contract

README is the **canonical orientation document** for Flux. Any change to platform surface area should update README (or document why not) in the **same commit** as the feature.

Full policy, triggers, cross-doc obligations, and agent checklist:

**[`docs/README-MAINTENANCE-CONTRACT.md`](docs/README-MAINTENANCE-CONTRACT.md)**

Summary:

- CLI, MCP, dashboard, gateway, backups, deploy scripts, env vars, security posture → update matching docs
- App developer footguns → `AGENTS.md` + `docs/pages/guides/*`
- Roadmap/priority shifts → `docs/TRAJECTORY-TODO.md`
- Mark experimental/beta/internal features honestly; do not document aspirational work as shipped

---

## Legacy and compatibility notes

| Topic | Note |
|-------|------|
| **API hostname** | Canonical: `https://api--<slug>--<hash>.<domain>`. Legacy dotted `api.<slug>.<hash>.<domain>` may still work on older v1 stacks. |
| **`projects.mode` NULL** | Treated as `v1_dedicated`. |
| **Pooled migration ledger** | Pre–Pass 1B global `flux.flux_migrations` may require `bin/migrate-pooled-ledger.sh`. |
| **MCP auth** | Prefer `FLUX_MCP_TOKEN` (`flx_mcp_*`); `FLUX_API_TOKEN` (`flx_live_*`) works with deprecation warning for MCP server only. |
| **v1 local-Docker CLI** | Many commands now use Bearer API when `flux login` is configured; Docker socket still required on control-plane host for v1 ops. |

---

- Last reviewed: `2026-08-20`
