# Flux

**Flux** is a slim **Backend-as-a-Service (BaaS)** / **Database-as-a-Service (DBaaS)** platform with two runtime modes:

- **`v1_dedicated`** — each project gets its own **PostgreSQL** container with durable storage and a **PostgREST** container that exposes your tenant API schema as a **REST API** without hand-written CRUD servers.
- **`v2_shared`** — projects share a **pooled** Postgres/PostgREST **data plane** with **schema + role** isolation behind the Flux gateway.

The **control plane** (CLI + optional Next.js dashboard) provisions, tracks, and operates both modes through a common project catalog. The goal is to run **many tenant backends** on a **Docker host** (dedicated stacks) or a **shared pool** (schema-isolated tenants) in a repeatable way. Long-term, you can layer **auth**, **billing**, and **routing** without adopting a full managed platform like Supabase on day one.

---

## Table of contents

- [What ships in this repo](#what-ships-in-this-repo)
  - [Platform capabilities (to date)](#platform-capabilities-to-date)
- [Architecture at a glance](#architecture-at-a-glance)
- [v2 shared data plane wiring (internal)](#v2-shared-data-plane-wiring-internal)
  - [Mode-split: dashboard behavior per mode](#mode-split-dashboard-behavior-per-mode)
- [Production deploy workflow (internal)](#production-deploy-workflow-internal)
- [Monorepo layout](#monorepo-layout)
- [Code ownership map](#code-ownership-map)
- [Core concepts](#core-concepts)
- [Supabase → Flux (migrations)](#supabase--flux-migrations)
- [Packages deep dive](#packages-deep-dive)
- [Dashboard (`apps/dashboard`)](#dashboard-appsdashboard)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [End-to-end validation](#end-to-end-validation)
- [CLI reference](#cli-reference)
  - [Private database access](#private-database-access)
- [Security and operations](#security-and-operations)
  - [Pooled migration ledger upgrade](#pooled-migration-ledger-upgrade)
- [AGENTS.md (v2_shared client apps)](#agentsmd-v2_shared-client-apps)
- [Docs and guides](#docs-and-guides)
- [Trajectory TODOs (internal)](#trajectory-todos-internal)
- [Contributing mindset](#contributing-mindset)

---

## What ships in this repo

| Piece | Role |
|-------|------|
| **`@flux/core`** | Docker orchestration: networks, gateway, per-tenant Postgres + PostgREST, bootstrap SQL, **plain-SQL import** (Supabase-aware transforms, `public` → `api` move), JWT helpers, **environment updates** on the API container, Traefik label helpers. |
| **`@flux/cli`** | Operator-facing `flux` commands: provisioning, **`flux push`** / migrations ledger, lifecycle, backups + restore verify, **`flux db …`** inspection + private database access (SSH tunnels), project doctor, **`FLUX.md`** brief sync, env, gauntlet smoke, v2→v1 migrate. |
| **`@flux/sdk`** | Small TypeScript client over PostgREST-style HTTP (table queries, anon key headers). |
| **`@flux/engine-v2`** | Shared-cluster provisioning: tenant schema + role bootstrap, pooled push, temp DB access roles, deprovision. |
| **`@flux/gateway`** | Edge gateway (`flux-node-gateway`): host routing, JWT mint, rate limits, proxy to PostgREST pool. |
| **`apps/dashboard`** | Next.js **control-plane UI**: GitHub sign-in, project list/create, lifecycle, credentials, **Private Database Access** panel, backups + destructive gates, billing hooks, rendered docs at `/docs`, CLI Bearer API — all backed by **`flux-system`**. |

Everything assumes **one Docker Engine** (local socket or `DOCKER_HOST`) and **pnpm** workspaces (**pnpm 10.x**, see root `packageManager`).

### Platform capabilities (to date)

Operator-oriented checklist of what Flux ships **today** (both engines unless noted):

| Area | Capability |
|------|------------|
| **Provisioning** | `flux create` / dashboard create — **`v1_dedicated`** (per-tenant Postgres + PostgREST) or **`v2_shared`** (pooled schema + role). `flux init` links a Foundry repo. `flux list` prints slug, hash, mode, canonical Service URL. |
| **SQL & migrations** | `flux push` — single `.sql` or ordered **`migrations/`** directory with **`--mode raw\|versioned\|repeatable`**, **`--plan`**, **`--dry-run`**. v2 ledger: **`flux.flux_migrations (tenant_schema, version)`**. `flux migrations list`. Supabase-compat transforms on import. |
| **Engine conversion** | `flux migrate` — orchestrates **v2_shared → v1_dedicated** via control plane (destructive; restore-verified backup gate). |
| **Backups** | `flux backup create \| list \| verify \| download` — v1 full project DB; v2 **tenant schema export** only. Optional R2 offsite (`FLUX_R2_BACKUPS_*`). Hourly minimum-backup scheduler (`FLUX_MIN_BACKUP_*`). |
| **Destructive gates** | Restore-verified backup required before **`flux nuke`**, **`flux migrate`**, **`flux db-reset`**, **`flux db restore`**, dashboard **Delete** / **Factory reset** — unless explicit override (`--skip-backup-check` / `?skipBackupCheck=true`). Shared primitive: `@flux/core/backup-trust`. |
| **Private DB access** | **`flux db tunnel \| shell \| dump \| restore \| password \| access-plan \| gui-config`** — Postgres stays off the public internet; SSH tunnel to Docker-internal host. v1: project **`postgres`** password. v2: **temporary scoped roles** (readonly default); pooled admin never exposed. See [Private database access](#private-database-access). |
| **Lifecycle** | `flux start \| stop \| nuke`, **`flux project wake \| sleep \| archive`**, dashboard lifecycle panel, `flux reap` (idle stop). Dormant/archived projects return **503** at the gateway until woken. |
| **Project understanding** | **`flux db inspect \| tables \| describe \| counts`**, dashboard Schema Explorer + data preview, **`flux doctor`**, activity timeline, portfolio dashboard (lifecycle groups), **`FLUX.md`** repo brief (`flux project brief push \| generate`), portfolio one-line description via **`flux project metadata --description`**, AI summaries when Workers AI is configured (`flux project summarize`, dashboard Generate draft). |
| **Tenant env** | `flux env set \| list` on PostgREST container (sensitive keys redacted in list). |
| **Auth & API** | PostgREST JWT (`PGRST_JWT_SECRET` / gateway secret on v2). Gateway Bearer on v2 edge. RLS + **`GRANT`** per tenant role. Docs: [`AGENTS.md`](./AGENTS.md), `/docs/guides/nextjs`. |
| **Observability** | `flux logs`, dashboard log stream (v1). Fleet monitor + deep v2 JWT probes. `bin/ops-audit.sh`. |
| **Dashboard product** | GitHub OAuth, Stripe checkout hooks, project detail (mode-aware UI), lifecycle + portfolio views, **`FLUX.md`** brief panel, backup trust UI, schema explorer, activity timeline, project doctor, Private Database Access copy, interactive docs + Codex on `/docs`. |
| **CLI control plane** | `flux login`, Bearer **`/api/cli/v1/*`** routes (push, credentials, db-access, backups, migrate, lifecycle). |

Canonical user docs (rendered at **`https://flux.vsl-base.com/docs/`** when deployed): source lives in **`docs/pages/`** — e.g. [Private database access](./docs/pages/guides/database-access.md) → `/docs/guides/database-access`.

**Typical versions in tree:** **Node.js** 20+ / **TypeScript** 5–6 (strict), **Next.js 16** + **React 19** (dashboard), **Auth.js** (`next-auth` v5 beta) with **Drizzle ORM** + **`pg`**, **Stripe** server SDK, **Commander** + **Chalk** (CLI), **dockerode** + **`pg`** + **jsonwebtoken** (`@flux/core`).

---

## Architecture at a glance

### Control plane vs data plane

- **Control plane** — Node processes (CLI, Next.js server) that call the Docker API and, for the dashboard, connect to **`flux-system`** Postgres over **`flux-network`** (see `getPostgresHostConnectionString` / Drizzle; typically no published 5432 on the public internet). It decides *what* runs, not tenant query traffic at scale.
- **Data plane** — Each tenant’s **Postgres** (data) and **PostgREST** (HTTP API). App traffic hits PostgREST (via Traefik), not the Next.js app.

### Docker resources (names are stable conventions)

| Resource | Purpose |
|----------|---------|
| **`flux-network`** | User-defined bridge (`FLUX_NETWORK_NAME`). **Traefik** and all **PostgREST** (tenant) containers attach here. **Not** the primary network for customer tenant **Postgres** (those are on a per-tenant **internal** network `flux-<hash>-<slug>-net` for isolation; **`flux-system`** Postgres is a deliberate exception: private net **and** this bridge for the control plane). |
| **`flux-<hash>-<slug>-net`** | **Internal** bridge per project: Postgres and PostgREST share it so `PGRST_DB_URI` resolves; no route to the public internet. Customer Postgres is **not** on `flux-network`. |
| **`flux-gateway`** | Traefik (`FLUX_GATEWAY_CONTAINER_NAME`) — Docker provider, read-only socket mount, listens on **host :80**, discovers routers from **labels** on the PostgREST containers. |
| **`flux-<hash>-<slug>-db`** | **PostgreSQL 16.2** (Alpine), volume **`flux-<hash>-<slug>-db-data`**. **No host port** — bootstrap and admin SQL use **`docker exec`**. For tenants, the DB is only on the **private** network above. |
| **`flux-<hash>-<slug>-api`** | **PostgREST** — on **`flux-network`** and the private net; **Traefik** routes the public host to **3000**. |

The Traefik **`flux-gateway`** container is **not** created by `provisionProject`; start it with Compose from **`docker/traefik/docker-compose.yml`** (and the `letsencrypt` volume next to that file). `@flux/core` only checks that a running container named **`flux-gateway`** exists.

Provisioning (`ProjectManager.provisionProject`) ensures **`flux-network`** and the per-tenant private network, ensures the **Traefik** gateway is running, creates the volume and Postgres container, runs **`BOOTSTRAP_SQL`**, then creates the PostgREST container with Traefik labels so the tenant **HTTPS/HTTP** API URL resolves.

### HTTP path to a tenant API

1. Client requests **`http://myapp.flux.localhost/...`** (Host header matches Traefik router rule **`Host(\`myapp.flux.localhost\`)`**).
2. **Traefik** applies a **per-tenant Headers** CORS middleware (`flux-<slug>-cors`: dashboard + env extras + HTTPS `*.domain` regex) and, when enabled, **`flux-<slug>-stripprefix`** so paths under **`/rest/v1`** match **Supabase JS** (PostgREST itself serves resources at **`/`**).
3. **Traefik** forwards to **`flux-myapp-api:3000`**.
4. **PostgREST** connects to **`flux-<hash>-<slug>-db:5432`** on the **private** project network using **`PGRST_DB_URI`** (Docker DNS; not resolvable from unrelated containers on `flux-network`).

Tenant PostgREST is configured with **`PGRST_DB_SCHEMAS=api,public`** (`api` first for the default schema). **`PGRST_JWT_SECRET`** is generated at provision time (or taken from dashboard **`customJwtSecret`**). **`getProjectKeys`** / **`getProjectCredentials`** read that secret **only** from the running API container’s **`inspect().Config.Env`**—they never mint a substitute secret.

### Schema changes and cache reload

After SQL runs **inside the tenant Postgres container** via the Docker API (`executeSql`, `importSqlFile`, or `flux push`), Flux runs `NOTIFY pgrst, 'reload schema'` in Postgres, waits briefly, then sends **SIGUSR1** to the **`flux-<hash>-<slug>-api`** container so PostgREST reloads its schema cache. (This matches PostgREST’s documented signal behavior; do not assume **SIGHUP** for schema cache.)

---

## v2 shared data plane wiring (internal)

This section describes the **actual running topology for v2** in this repo today.  
Treat it as an operator-level source of truth.

### Runtime components (v2 path)

| Layer | Component | Purpose |
|-------|-----------|---------|
| Control plane | `apps/dashboard` + `@flux/core` + `@flux/engine-v2` | Create/delete projects, bootstrap tenant schema + role, persist catalog rows in `flux-system` |
| Edge/data-plane ingress | `@flux/gateway` (`flux-node-gateway`) | Resolve host -> tenant, rate-limit, mint JWT, proxy to PostgREST pool |
| Shared API pool | `postgrest-pool` (`flux-postgrest-pool`) | Shared PostgREST runtime behind gateway |
| Shared DB pooler | `pgbouncer` (`flux-pgbouncer`) | Transaction pooling for shared Postgres cluster |
| Shared cluster | `postgres-v2` (`flux-postgres-v2`) | All v2 tenant schemas + roles |

### Network wiring

`docker/v2-shared/docker-compose.yml` attaches services as follows:

- `postgres-v2`: `flux-v2-shared` + `flux-network`
- `pgbouncer`: `flux-v2-shared` + `flux-network`
- `postgrest-pool`: `flux-v2-shared` + `flux-network`

`docker/web/docker-compose.yml` attaches `flux-web` to:

- `flux-network` (control-plane + Traefik)
- `flux-v2-shared` (so `FLUX_SHARED_POSTGRES_URL` can resolve shared-cluster hosts)

### Mesh HTTP probes from `flux-web` (internal)

Fleet monitor and v2 “start” power actions probe each tenant by HTTP. By default the code uses the public URL from `fluxApiUrlForSlug` / `fluxApiUrlForCatalog` (canonical: `https://api--<slug>--<hash>.<domain>`). **Inside the `flux-web` container** that `fetch` often fails even when the tenant is healthy: Traefik / ACME may not cover the public name, or internal DNS may not resolve it the same way as a browser on the internet.

**Recommended in production:** set `FLUX_TENANT_PROBE_GATEWAY_URL=http://flux-node-gateway:4000` in `docker/web/.env` (both `flux-web` and `flux-node-gateway` are on `flux-network`). Probes then call that internal base URL and send `Host: api--<slug>--<hash>.<domain>` so the Node gateway routes exactly like a real client, without TLS to the public name. v2 fleet health mints a short-lived project JWT (`jwt_secret` required); see `apps/dashboard/src/lib/tenant-api-probe.ts`.

### JWT and schema isolation handshake

1. Gateway resolves request host to `tenant_id`.
2. Gateway verifies the client's project Bearer JWT (HS256 with per-project `jwt_secret`).
3. Gateway mints a short-lived bridge JWT (HS256 with `FLUX_GATEWAY_JWT_SECRET` / `PGRST_JWT_SECRET`) carrying `role: t_<shortid>_role` and stable `sub`.
4. Gateway injects on the upstream PostgREST request:
   - `Authorization: Bearer <bridge JWT>`
   - `Accept-Profile: t_<shortid>_api` (GET/HEAD)
   - `Content-Profile: t_<shortid>_api` (POST/PATCH/PUT/DELETE)
5. PostgREST **pre-config** hook (`public.flux_postgrest_config`, runs on config reload):
   - Sets `pgrst.db_schemas` to `public` plus every existing `t_<12hex>_api` schema (pattern match — not a static `PGRST_DB_SCHEMAS` tenant list).
   - After provisioning a new tenant, emit `pg_notify('pgrst', 'reload config')` and `pg_notify('pgrst', 'reload schema')`.
6. PostgREST **pre-request** hook (`public.flux_set_tenant_context`, per request after SET ROLE):
   - Derives the tenant schema from `current_user` (`t_<shortid>_role`).
   - Applies transaction-scoped GUCs via `set_config(..., true)` for `search_path` and `statement_timeout`.
   - Do **not** use `SET LOCAL` inside this PL/pgSQL function — it reverts when the function returns, so the main query would still hit `public`.

**Fleet probes:** `GET /` with a minted project JWT and tenant `Accept-Profile` returns OpenAPI for that schema; table reads use the same profile headers (e.g. `GET /your_table`).

### Provision/delete lifecycle (v2)

- `provisionProject({ tenantId })`:
  - derives `shortId` from immutable `tenantId`
  - collision-checks ownership marker (`COMMENT ON SCHEMA ... IS 'tenant:<uuid>'`)
  - creates schema + role idempotently
  - reapplies guardrails every run (`CONNECTION LIMIT`, `statement_timeout`, `search_path`)
  - emits `pg_notify('pgrst', 'reload config')`
- `deprovisionProject(tenantId)`:
  - `DROP SCHEMA ... CASCADE`
  - `DROP ROLE ...` (guarded)
- Project delete route also evicts `hostname:*` cache entries to avoid zombie routing.

### Mode-split: dashboard behavior per mode

Every project row in `flux-system.projects` carries a `mode` column (`v1_dedicated` | `v2_shared` | `NULL`). `NULL` is treated as `v1_dedicated` everywhere. The dashboard branches on this value before touching Docker so that v2 rows — which **never** have per-tenant containers — never generate spurious Docker errors.

#### `projects.mode` values

| Value | Meaning |
|-------|---------|
| `v1_dedicated` | Dedicated Docker stack: `flux-<hash>-<slug>-db` + `flux-<hash>-<slug>-api`. All Docker-based operations apply. |
| `v2_shared` | Shared-cluster tenant. No per-tenant containers. All Docker operations are skipped or 4xx/5xx-ed. |
| `NULL` | Legacy row; treated as `v1_dedicated` throughout. |

#### API route behavior (v1 vs v2)

| Route | v1_dedicated | v2_shared |
|-------|-------------|-----------|
| `GET /api/projects` | Docker `getProjectSummariesForSlugs` → status | Catalog `health_status` via `statusFromV2CatalogHealth` (no Docker) |
| `GET /api/projects/[slug]` | Docker inspect → `status`, `apiUrl` | Catalog health only; includes `mode` in response |
| `PUT /api/projects/[slug]` (start/stop) | `startProjectInfrastructure` / `stopProject` (Docker) | Start: HTTP probe → sets `running` or `error` in catalog. Stop: sets `stopped` in catalog only |
| `PATCH /api/projects/[slug]` (JWT rotate) | Recreates PostgREST container with new secret | `400` — pooled PostgREST uses a shared gateway secret |
| `GET /api/projects/[slug]/logs` | Docker `getTenantContainerLogs` | `200` JSON with explanatory hint string (no Docker call) |
| `GET /api/projects/[slug]/logs/stream` | SSE stream from Docker container logs | SSE with single `data: {"error":"…"}` event, then closes |
| `GET /api/cli/v1/logs` | SSE stream from Docker container logs | SSE with single `data: {"error":"…"}` event, then closes |
| `GET /api/projects/[slug]/credentials` | Returns Postgres URI + anon/service JWTs from container env | `501` — use CLI gateway JWT path instead |
| `GET /api/cli/v1/projects/[hash]/credentials` | Postgres URI + anon/service JWTs from container env | Gateway JWT secret + note (no per-tenant Postgres URI) |
| `GET /api/cli/v1/projects/[hash]/db-access` | Redacted access plan (tunnel target, capabilities, SSH defaults) | Supported plan + temp-credential capability |
| `POST /api/cli/v1/projects/[hash]/db-access/temporary-credential` | — (v2 only route; v1 returns error) | Creates short-lived readonly login role; password returned once |
| `GET /api/projects/[slug]/manifest` | Reads Postgres superuser password from container env | `{ apiUrl, postgresPassword: "", passwordSource: "unavailable" }` |
| `DELETE /api/projects/[slug]` | `nukeProject` (Docker containers + volume) | `deprovisionProject` (drop shared-cluster schema + role) |

#### Fleet monitor (`src/lib/fleet-monitor.ts`)

On every 2-minute tick (`runFleetMonitorTick`) and on the immediate post-create probe (`probeSingleProject`):

- **v1_dedicated** — `getProjectSummariesForSlugs` (Docker inspect batch); if stopped, records `stopped`; otherwise HTTP probes the PostgREST URL and records `running` or `error`.
- **v2_shared** — HTTP probe only (no Docker); records `running` or `error` directly in `projects.health_status`.

`getProjectSummariesForSlugs` is **never called for v2 rows** — the Docker batch only runs when there is at least one v1 project in the catalog.

#### `statusFromV2CatalogHealth` (`src/lib/v2-project-status.ts`)

Maps `projects.health_status` to the frontend `ServerStatus` type used by both API list responses and UI badges:

| `health_status` | `status` returned |
|-----------------|-------------------|
| `"running"` | `"running"` |
| `"stopped"` | `"stopped"` |
| `"error"` | `"partial"` |
| `NULL` / anything else | `"partial"` |

#### UI controls hidden for v2 (`project-card.tsx`, `project-summary-card.tsx`)

| Control | v1_dedicated | v2_shared |
|---------|-------------|-----------|
| Start / Stop buttons | Shown | Hidden |
| Settings (JWT rotate) | Shown | Hidden; `autoOpenSettings` prop also suppressed |
| Load connection secrets | Shown (when stack healthy) | Hidden (`canRevealCredentials = false`) |
| Container logs panel | Shown | Hidden |
| Repair button | Shown when `missing` / `corrupted` | Shown when `healthStatus === "error"` |
| Private Database Access panel | CLI copy + GUI field hints (v1 → `flux db password`) | Temp creds via `flux db tunnel`; pooled restore restricted |
| Delete | "destroys all containers and volumes" copy | "removes shared-cluster tenant schema and role" copy |
| "How to connect" description | Standard Postgres URI + anon/service JWT copy | Notes pooled project; instructs gateway JWT usage |

---

## Production deploy workflow (internal)

### Server filesystem layout (production host)

On the primary Docker host the Flux monorepo is checked out at **`/srv/platform/flux`**. That matches **`APP_DIR`** in **`packages/cli/deploy-flux-web.sh`** and the default **`FLUX_REMOTE_REPO_ROOT`** in **`bin/sync-env-remote.sh`**. **`bin/deploy*.sh`** scripts assume **`$REPO_ROOT`** is that clone when you run them on the server.

Other top-level trees often live alongside it and are **not** this repo, for example:

- **`/srv/infra`** — shared infrastructure (Traefik, certificates, etc.) when kept outside the Flux tree.
- **`/srv/apps/<name>`** — separate applications (example: **`packages/cli/deploy-yeastcoast.sh`** uses **`/srv/apps/yeast-coast`**).

If your host uses a different path, set **`FLUX_REMOTE_REPO_ROOT`** / **`APP_DIR`** to the real checkout before env sync or deploy.

### Launch flux-web from your laptop

Use **`bin/launch-web.sh`** for the full dashboard release loop: preflight → commit/push → optional env sync → remote pull → **`bin/deploy-web.sh`**.

```bash
# Typical landing-page / dashboard release
./bin/launch-web.sh --commit "feat: apps-first landing page" --tag web-2026.06.10

# Preview the plan without pushing or SSH
./bin/launch-web.sh --dry-run --commit "feat: ..."

# Push env changes before deploy (whitelisted paths in bin/sync-env-remote.sh)
./bin/launch-web.sh --sync-env-apply --commit "chore: rotate activity secret"

# Remote-only (already pushed; matches legacy packages/cli/deploy-flux-web.sh)
./bin/launch-web.sh --remote-only
```

**Defaults:** `root@178.104.205.138`, remote checkout `/srv/platform/flux`, branch `main`. Override with `FLUX_LAUNCH_REMOTE`, `FLUX_LAUNCH_APP_DIR`, `FLUX_LAUNCH_BRANCH` (or legacy `REMOTE` / `APP_DIR` / `BRANCH`).

**Preflight** runs `pnpm typecheck` and `pnpm --filter dashboard run build` unless you pass `--skip-checks` or `--remote-only`.

**Env sync** is off by default. Pass `--sync-env` (dry-run) or `--sync-env-apply` to rsync `docker/web/.env`, `packages/gateway/.env`, and `docker/v2-shared/.env`.

For a full stack deploy on the server (v2 + gateway + web), use **`bin/deploy-all.sh`** instead — `launch-web.sh` only cycles **`flux-web`**.

### Canonical order

Run in this order on the server:

1. `./bin/deploy-v2-shared.sh`
2. `./bin/deploy-gateway.sh`
3. `./bin/deploy-web.sh`

Orchestrated equivalent:

```bash
./bin/deploy-all.sh
```

### Why this order matters

- Data plane first: ensures Postgres/PgBouncer/PostgREST are healthy before gateway switches traffic.
- Gateway second: ensures routing points to ready upstreams.
- Dashboard last: control-plane UX comes up after infrastructure.

### Health gates (must-pass)

```bash
curl -fsS http://127.0.0.1:4000/health && echo
curl -fsS http://127.0.0.1:4000/health/deep && echo
pnpm --filter dashboard test
```

### Failure triage quick map

| Symptom | Likely root cause | First check |
|--------|-------------------|-------------|
| `flux-node-gateway` restart loop | runtime module resolution / env validation crash | `docker logs --since 5m flux-node-gateway` |
| gateway `health` fails with reset | process crashed before listener stabilized | same logs + `docker inspect ... State` |
| v2 provision fails in dashboard | `FLUX_SHARED_POSTGRES_URL` DNS/network mismatch | verify `flux-web` attached to `flux-v2-shared` and URL host |
| v2 mesh shows **Partial** / **Offline** but curl to tenant works | public `https://` probe from `flux-web` fails (TLS / DNS) | set `FLUX_TENANT_PROBE_GATEWAY_URL=http://flux-node-gateway:4000` in `docker/web/.env` and recreate `flux-web` |
| v2 mesh **Offline** after Pass 4 deploy | catalog `jwt_secret` null or JWT probe not 2xx | run **Repair** on the project; optional `FLUX_TENANT_PROBE_SHALLOW=1` for legacy 401-only probes |
| `flux backup create` → `EACCES` on `/srv/flux` | control plane runs as non-root `nextjs`; default backup dirs were not writable | redeploy `flux-web` with `docker/web/flux-web-entrypoint.sh` + compose volumes (see `docker/web/docker-compose.yml`), or set `FLUX_BACKUPS_LOCAL_DIR` / `FLUX_BACKUPS_OFFSITE_DIR` to writable paths |
| `flux-web` logs `EACCES` on `/var/run/docker.sock` | entrypoint dropped to `nextjs` without the host `docker` GID (e.g. old `su-exec` behavior) | rebuild `flux-web` with `setpriv` entrypoint + `FLUX_DOCKER_SUPPLEMENTARY_GID` / `DOCKER_GID` in `docker/web/docker-compose.yml` (see `.env.example`) |
| PostgREST returns wrong schema data | missing profile headers / hook misconfig | gateway proxy headers + `PGRST_DB_PRE_REQUEST` |
| stale custom-domain routing | Redis cache not evicted | domain CRUD/delete path calls `evictHostname(s)` |
| `flux push migrations/` fails: legacy global ledger has N row(s) | shared Postgres still has pre–Pass 1B `flux.flux_migrations` (version-only PK) with rows | `./bin/migrate-pooled-ledger.sh --assign-legacy-to t_<shortId>_api` on the Flux host (see [Pooled migration ledger](#pooled-migration-ledger-upgrade)) |

---

## Monorepo layout

The workspace is defined in **`pnpm-workspace.yaml`** (`packages/*`, `apps/*`). Dependencies use **`workspace:*`** so local packages link without publishing.

| Path | Package | Responsibility |
|------|---------|------------------|
| `packages/core` | **`@flux/core`** | `ProjectManager`, Docker + volume + network + gateway, `BOOTSTRAP_SQL`, tenant Postgres ops via **`docker exec`** (`pg_isready`, `psql`; tar upload for large SQL), PostgREST reload signaling, `setProjectEnv` / `listProjectEnv`, JWT key derivation from `PGRST_JWT_SECRET`. |
| `packages/cli` | **`@flux/cli`** | `flux` entry (`src/index.ts`), Commander + Chalk, calls into `ProjectManager`. |
| `packages/sdk` | **`@flux/sdk`** | `createClient`, `FluxClient`, PostgREST-shaped `select`/`insert`/`update`/`delete` + `eq` filters over `fetch`. |
| `apps/dashboard` | **`dashboard`** (private) | Next.js App Router, Auth.js, Drizzle + `pg` to `flux-system`, API routes under `app/api/*`, Stripe integration, `instrumentation.ts` for DB init. |
| `docs/guides/` | — | **PostgreSQL / Supabase → Flux** import guide, **Clerk + PostgREST**, **Flux + Next.js (`v2_shared`) quickstart**, and **Auth.js + RLS extension**. |

Root **`package.json`** is minimal; install and scripts are usually run with **`pnpm --filter <name>`** from the repo root.

---

## Code ownership map

Focused notes for contributors: where to look before moving symbols or adding surface area. This is not a full architecture spec.

| Area | Owns |
|------|------|
| **`packages/core/src/index.ts`** | Public **re-exports only** — add behavior in feature modules, then export from here. |
| **`packages/core/src/projects/`** | Project orchestration (`ProjectManager`, lifecycle, runtime mode helpers, stack deletion). |
| **`packages/core/src/docker/`** | Docker naming, client usage, resource limits, stack/container operations, log streaming. |
| **`packages/core/src/database/`** | Tenant DB bootstrap SQL, tenant Postgres primitives (passwords, bootstrap helpers). |
| **`packages/core/src/traefik/`** | Traefik labels, CORS origins, host rules, strip-prefix middleware wiring. |
| **`packages/cli/src/index.ts`** | CLI **entrypoint only**. |
| **`packages/cli/src/commands/`** | Commander registration and command wiring. |
| **`packages/cli/src/api-client/`** | HTTP transport to the dashboard control-plane API, Zod schemas, and per-domain client helpers. |
| **`apps/dashboard/src/lib/db/`** | **flux-system** catalog access: connection/bootstrap orchestration in `index.ts`. |
| **`apps/dashboard/src/lib/db/system-db-bootstrap.ts`** | **Bootstrap / migration-sensitive** additive catalog DDL. Destructive legacy cutovers are gated in `system-db-cutovers.ts` (`FLUX_SYSTEM_DB_ALLOW_DESTRUCTIVE_CUTOVER`). |
| **`apps/dashboard/src/components/projects/project-card*.tsx`** | Project detail card UI; modals and connect panel split from `project-card.tsx`. |

CI runs typechecks and tests across these packages so barrel and import-path mistakes fail fast (see `.github/workflows/ci.yml`).

---

## Core concepts

### Project name and slug

User-facing names are **slugified** for container and volume names (lowercase, hyphen-separated). The CLI and dashboard accept display names; Docker objects always use the slug (e.g. **`my-app`** → `flux-my-app-db`).

### Bootstrap SQL (`BOOTSTRAP_SQL`)

On first connection to a new tenant DB, Flux runs SQL that:

- Creates schema **`api`** and grants **`anon` / `authenticated`** usage on **`api`** and **`public`** (so **`PGRST_DB_SCHEMAS=api,public`** can resolve both).
- Creates roles **`authenticator`**, **`anon`**, **`authenticated`** and applies **`API_SCHEMA_PRIVILEGES_SQL`** (table/sequence grants + default privileges) so PostgREST’s JWT role model works.
- Creates schema **`auth`** and function **`auth.uid()`** (**`text`**, JWT **`sub`** via **`request.jwt.claims`**) for Supabase-style RLS with Clerk / NextAuth string IDs.

### JWTs and keys

PostgREST verifies JWTs with **`PGRST_JWT_SECRET`**. The dashboard (and **`getProjectKeys`** in core) derive **anon** and **service_role**-style JWTs **from the container env only** (same material PostgREST uses). You can align this secret with an external issuer (e.g. Clerk); see **`docs/pages/guides/clerk.md`** (renders at `/docs/guides/clerk`).

### Tenant environment variables (“project bucket”)

The **PostgREST container** carries all runtime env: built-in `PGRST_*` variables plus **custom** keys (Stripe, public URLs, etc.). **`ProjectManager.setProjectEnv`** merges new keys into the existing container env and **recreates** the API container (same image, Traefik labels, network, limits) so changes apply. The CLI exposes this as **`flux env set`** / **`flux env list`** (list hides values for sensitive key names—see `isFluxSensitiveEnvKey` in `@flux/core`).

---

## Supabase → Flux (migrations)

Flux can ingest **plain `pg_dump` SQL** from Supabase-style apps and land tables in the **`api`** schema PostgREST exposes.

| Capability | Where it lives |
|------------|----------------|
| **Dump transforms** | `preparePlainSqlDumpForFlux`, `applySupabaseCompatibilityTransforms` — optional `auth` stubs, `auth.uid()` (**text**), seed rows before `auth.users` FKs. |
| **`public` → `api`** | After import with **`moveFromPublic`**, `movePublicSchemaObjectsToApi` moves tables / sequences / views; if **`api.<name>`** already exists (dump created both), the **`public`** duplicate is **`DROP … CASCADE`**’d instead of failing. |
| **Grants after import** | Every **`importSqlFile`** ends by re-running **`API_SCHEMA_PRIVILEGES_SQL`** so **`anon` / `authenticated`** keep DML on all **`api`** objects. |
| **RLS (local / porting)** | Optional **`disableRowLevelSecurityInApi`** / CLI **`--disable-api-rls`**: disables RLS on **`api`** tables that still have it enabled (Supabase policies often block **`anon`** until rewritten). |
| **Gateway + browser** | Default Traefik labels: **CORS** (`flux-<slug>-cors`) for **`http://localhost:3001`**, dashboard, **`https://*.<FLUX_DOMAIN>`** via regex, plus **`flux-<slug>-stripprefix`** for **`/rest/v1`**. New projects default to strip on; **`flux create --no-supabase-rest-path`** opts out. **`flux supabase-rest-path -p <name>`** updates an existing API container; pass **`--off`** to remove strip from the middleware chain. |
| **Dashboard create** | `POST /api/projects` accepts optional **`stripSupabaseRestPrefix`** (boolean) and **`customJwtSecret`**. |

**Typical CLI flow**

```bash
flux db-reset -p myapp --yes
flux push ./dump.sql -p myapp -s --disable-api-rls
```

- **`-s` / `--supabase-compat`** — compatibility transforms + move **`public` → `api`** after the file runs.  
- **`--disable-api-rls`** — post-import RLS teardown for **`api`** (see `@flux/core` **`DISABLE_ROW_LEVEL_SECURITY_FOR_RLS_ENABLED_API_TABLES_SQL`**).  
- **`--no-sanitize`** — do not strip unsupported `SET` lines (advanced).

**Downstream app (e.g. Next.js + Supabase JS)** — point **`NEXT_PUBLIC_SUPABASE_URL`** at **`http://<slug>.flux.localhost`** with **no** `/rest/v1` suffix, use dashboard **anon key**, and set **`createClient(..., { db: { schema: "api" } })`**. Full notes: **`docs/guides/postgresql-import-to-flux.md`**.

---

## Packages deep dive

### `@flux/core` (`packages/core`)

- **Exports** — `ProjectManager`, `FLUX_NETWORK_NAME`, `FLUX_GATEWAY_CONTAINER_NAME`, `FLUX_DOCKER_IMAGES`, `fluxApiUrlForSlug`, `BOOTSTRAP_SQL`, **`FLUX_AUTH_SCHEMA_AND_UID_SQL`**, **`API_SCHEMA_PRIVILEGES_SQL`**, **`DISABLE_ROW_LEVEL_SECURITY_FOR_RLS_ENABLED_API_TABLES_SQL`**, dump helpers (`preparePlainSqlDumpForFlux`, `sanitizePlainSqlDumpForPostgresMajor`, `applySupabaseCompatibilityTransforms`, `queryPostgresMajorVersion`), `isFluxSensitiveEnvKey`, types (`FluxProject`, `FluxProjectSummary`, `FluxProjectEnvEntry`, `ImportSqlFileOptions`, …).
- **Docker** — `dockerode`; pulls with stall detection; idempotent network/gateway provisioning.
- **Typical flows** — `provisionProject`, `listProjects`, **`getProjectSummariesForSlugs`**, `stopProject` / `startProject`, `nukeProject`, **`reapIdleProjects`**, `stopInactiveProjects` (reporting), `getPostgresHostConnectionString`, **`getProjectCredentials`**, `executeSql`, **`importSqlFile`** (optional Supabase compat + **`moveFromPublic`**, post-import grants + optional RLS disable), **`resetTenantDatabaseForImport`**, `updatePostgrestJwtSecret`, **`setPostgrestSupabaseRestPrefix`**, `setProjectEnv`, `listProjectEnv`, **`getProjectKeys`** (JWTs from container **`PGRST_JWT_SECRET` only**).

### `@flux/cli` (`packages/cli`)

- Entry: **`packages/cli/bin/flux`** (runs the TypeScript entry via `tsx` for development).
- Uses **Commander** for subcommands, **Chalk** for output.

### `@flux/sdk` (`packages/sdk`)

- Minimal **PostgREST client**: base URL + optional anon JWT as `apikey` / `Authorization` bearer.
- Optional **`activity`** options: after each **successful** PostgREST response, fire-and-forget `POST` to the dashboard **`/api/projects/{slug}/activity`** (Bearer **`FLUX_ACTIVITY_SECRET`**) to refresh catalog **`last_accessed_at`** (used by **`reapIdleProjects`**). Slug is inferred from **`{slug}.flux.localhost`** or set explicitly.
- **Not** a full query builder—enough for app code to hit tables in the `api` schema with filters like `eq`.

---

## Dashboard (`apps/dashboard`)

The dashboard is the first **product UI** on top of `@flux/core`.

| Piece | Role |
|-------|------|
| **Next.js (App Router)** | UI under `app/`, Route Handlers under `app/api/`. |
| **`instrumentation.ts`** | On Node server start, imports **`initSystemDb()`** — provisions or starts the **`flux-system`** Docker project and ensures Drizzle/Auth tables exist. Logs **`[flux] System DB ready.`** or a clear failure if Docker is unreachable. |
| **`middleware.ts`** | Wraps **Auth.js** `auth` with a **matcher** that runs on most paths but **excludes** **`/api/cli/*`** (Bearer CLI API), static assets, **`/install`**, etc., so the CLI is never sent an HTML login response. |
| **Auth.js (`next-auth` v5)** | GitHub OAuth; sessions persisted via **`@auth/drizzle-adapter`** into **`flux-system`**. |
| **Drizzle + `pg`** | Schema in `src/db/schema.ts`; migrations can be managed with `drizzle-kit` if you adopt it. |
| **`@flux/core`** | `getProjectManager()` provisions tenant projects and drives start/stop/JWT/env updates from API routes (`app/api/projects/...`). |
| **Stripe** | `app/api/billing/checkout` and `app/api/billing/webhook` — billing hooks at the application layer; tenant data still lives in per-project Postgres. |

### Dashboard environment variables

Typical **`apps/dashboard/.env.local`** (never commit; root `.gitignore` covers `.env*`):

- **`AUTH_SECRET`** (or **`NEXTAUTH_SECRET`**) — session signing.
- **`GITHUB_ID`** / **`GITHUB_SECRET`** (or **`AUTH_GITHUB_ID`** / **`AUTH_GITHUB_SECRET`**) — GitHub OAuth.
- **`AUTH_URL`** or **`NEXTAUTH_URL`** — public base URL (e.g. `http://localhost:3000`) for OAuth redirects.
- **`FLUX_ACTIVITY_SECRET`** — shared secret for **`POST /api/projects/[slug]/activity`** (SDK idle bumps). Generate a long random string; must match the secret configured in apps that use **`@flux/sdk`** `activity` options.

See [Auth.js deployment env](https://authjs.dev/getting-started/deployment#environment-variables) for the full set.

---

## Prerequisites

- **Node.js** (LTS or current; ESM + strict TypeScript).
- **pnpm** (see root `packageManager` in `package.json`).
- **Docker Engine** with the socket available to your user (or **`DOCKER_HOST`** pointing at a remote engine).

---

## Quick start

```bash
git clone <repo-url>
cd flux
pnpm install
```

Run the CLI from the repo root (preferred — avoids `npx` npm update notices):

```bash
pnpm run flux -- --help
```

Or from `packages/cli`:

```bash
cd packages/cli
pnpm run flux -- --help
```

If you use a shell alias via `npx --prefix packages/cli`, `packages/cli/.npmrc` disables update
notifier spam; upgrading global npm (`npm install -g npm@11.15.0`) is optional.

**CLI audience:** After `flux login`, most users run in **operator** mode (quiet — no npm update
notices, version nags, or yellow advisory lines). **Admins** are listed on the control plane via
`FLUX_CLI_ADMIN_EMAILS` (dashboard `.env`). Local override: `FLUX_CLI_VERBOSE=1`. Check with
`flux whoami`.

**Re-login without a new key:** `flux login --refresh` re-verifies `~/.flux/config.json` (or
`FLUX_API_TOKEN`) and updates plan / CLI role. On interactive `flux login`, press **Enter** at the
prompt to keep the saved key. API keys are created only in the dashboard (shown once); the CLI
does not mint keys.

Run the dashboard:

```bash
pnpm --filter dashboard dev
```

---

## End-to-end validation

Assumes Docker is running.

### 1. Typecheck (optional)

```bash
cd packages/core && pnpm exec tsc --noEmit
cd packages/cli && pnpm exec tsc --noEmit
```

### 2. CLI smoke test

```bash
cd packages/cli
pnpm run flux -- list
pnpm run flux -- create "cli-smoke-test"
pnpm run flux -- env list --project "cli-smoke-test"
pnpm run flux -- env set PUBLIC_DEMO=hello --project "cli-smoke-test"
pnpm run flux -- list
pnpm run flux -- stop "cli-smoke-test"
pnpm run flux -- start "cli-smoke-test"
pnpm run flux -- nuke "cli-smoke-test" --yes
```

Confirm tenant URLs like **`http://cli-smoke-test.flux.localhost`** respond once Traefik and DNS/`/etc/hosts` are aligned.

### 3. Dashboard + GitHub OAuth

1. Create a [GitHub OAuth App](https://github.com/settings/developers); callback **`http://localhost:3000/api/auth/callback/github`** (adjust if the dev port differs).
2. Add **`apps/dashboard/.env.local`** with `AUTH_SECRET`, GitHub credentials, and `AUTH_URL`.
3. **`pnpm --filter dashboard dev`** — watch for **`[flux] System DB ready.`**
4. Open **`http://localhost:3000`**, sign in, create a project from **`/projects`**.

### 4. Production-style checks (dashboard)

```bash
pnpm --filter dashboard build
pnpm --filter dashboard lint
```

---

## CLI reference

Implementation: **`packages/cli/src/index.ts`**. Orchestration: **`ProjectManager`** in **`@flux/core`** (v1) and **`@flux/engine-v2`** (v2). **`flux --help`** and subcommand help are authoritative for flags on your installed build.

### Control plane & provisioning

| Command | Purpose |
|---------|---------|
| **`flux login`** / **`flux whoami`** | Store or verify Bearer token against **`FLUX_API_BASE`**. |
| **`flux init`** | Link or create project from repo-root **`flux.json`** (Foundry hash placeholder). |
| **`flux create <name>`** | Provision Postgres + PostgREST + Traefik labels (v1) or shared-cluster tenant (v2). |
| **`flux list`** | Catalog projects: slug, hash, mode, Service URL. |

### Migrations & SQL

| Command | Purpose |
|---------|---------|
| **`flux push <path>`** | Apply `.sql` or ordered **`migrations/`** directory; **`--mode raw\|versioned\|repeatable`**, **`--plan`**, **`--dry-run`**. Reloads PostgREST after apply. |
| **`flux migrations list`** | Show remote **`flux.flux_migrations`** ledger (not local files). |
| **`flux migrate`** | **v2_shared → v1_dedicated** conversion (destructive; backup gate). |
| **`flux db-reset -y`** | v1: drop/recreate **`public`** + **`auth`**, reapply bootstrap (backup gate). |

### Lifecycle & env

| Command | Purpose |
|---------|---------|
| **`flux start` / `stop` / `nuke`** | Tenant stack lifecycle. **`nuke`** is irreversible (backup gate). |
| **`flux env set` / `list`** | Merge PostgREST container env; list redacts sensitive keys. |
| **`flux supabase-rest-path`** | Toggle **`/rest/v1`** Traefik strip on v1 API container. |
| **`flux reap --hours N`** | Stop idle projects (activity timestamps). |
| **`flux project wake \| sleep \| archive`** | Product lifecycle (dormant drains gateway traffic; archived is frozen). |
| **`flux project metadata --description <text>`** | Optional one-line portfolio subtitle (distinct from repo **`FLUX.md`**). |
| **`flux project brief push \| generate \| prompt`** | Repo **`FLUX.md`** sync, AI draft (host Workers AI), or copyable generation prompt. |
| **`flux project summarize --kind activity\|resume`** | AI summary from schema, activity, backups, and metadata context. |
| **`flux doctor`** | PASS/WARN/FAIL health check (schema, API, migrations, backups). |
| **`flux db inspect \| tables \| describe \| counts`** | Read-only schema inspection without opening a SQL GUI. |
| **`flux activity`** | Project activity timeline (CLI). |

### Backups

| Command | Purpose |
|---------|---------|
| **`flux backup create`** | v1: full DB dump. v2: tenant schema export (`t_<shortId>_api`). |
| **`flux backup list`** | Trust labels (Restorable / not restore-verified / …). |
| **`flux backup verify`** | Disposable Postgres **`pg_restore`** — promotes backup to **restorable**. |
| **`flux backup download`** | Write custom-format archive to disk. |

### Credentials

| Command | Purpose |
|---------|---------|
| **`flux project credentials`** | v1: structured Postgres block (user, password, host, port, URL) + JWT keys. v2: gateway JWT secret + note. |
| **`--field postgres.password`** | Paste-friendly: print **only** the v1 Postgres password (no labels). Also: **`postgres.user`**, **`postgres.host`**, **`postgres.port`**, **`postgres.database`**, **`postgres.url`**. |

### Private database access

Postgres is **never** published on the public internet. The CLI opens a **local SSH tunnel** (`127.0.0.1:15432` by default) to the Docker-internal database host. Implementation: **`packages/cli/src/commands/db-access.ts`**, **`packages/core/src/projects/database-access.ts`**, dashboard routes under **`/api/cli/v1/projects/[hash]/db-access`**.

#### Server configuration

Set on **`flux-web`** ( **`docker/web/.env`** ):

```bash
# Bastion for SSH -L forwards (returned in access plans as tunnel.sshHost)
FLUX_DB_TUNNEL_SSH_HOST=178.104.205.138
# Optional overrides:
# FLUX_DB_TUNNEL_SSH_USER=root
# FLUX_DB_TUNNEL_SSH_PORT=22
```

Sync env + redeploy: **`./bin/launch-web.sh --sync-env-apply`**. Operators need SSH key access to the bastion; the CLI uses **`BatchMode=yes`** (no password prompts).

#### v1 dedicated flow

1. **`flux db tunnel <slug> --hash <hash>`** — opens tunnel; GUI config prints **Host/Port/User** but **does not** print the password.
2. **`flux db password <slug> --hash <hash>`** — prints **only** the Postgres password for Beekeeper/DBeaver paste.
3. Connect GUI to **`127.0.0.1`**, tunnel port, user **`postgres`**, SSL off.

Alternative structured reveal: **`flux project credentials <slug> --hash <hash>`** (full Postgres section + JWT keys).

#### v2 shared flow

1. **`flux db tunnel <slug> --hash <hash>`** — creates a **temporary readonly login role**; GUI config shows username + **one-time password** (never pooled admin credentials).
2. In **Beekeeper Studio** (or DBeaver / TablePlus), create a Postgres connection using the CLI GUI block:
   - **Host:** `127.0.0.1` · **Port:** tunnel port · **User:** temp role · **Password:** one-time password
   - **Database:** **`postgres`** — not the temp username (Beekeeper defaults Database to User if left blank → `database "flux_temp_ro_…" does not exist`)
   - **SSL:** off · **SSH tunnel in GUI:** off (Flux CLI already opened the SSH tunnel)
   - **Tenant schema / search path:** values printed by the CLI (`t_<shortId>_api`, public)
3. **`flux db password`** **refuses** v2 — use tunnel temp creds instead.

Read/write temp roles require platform policy **`FLUX_DB_ACCESS_ALLOW_READWRITE=1`** (default off).

#### `flux db` commands

| Command | v1 | v2 |
|---------|----|----|
| **`flux db access-plan`** | Dedicated container target, capabilities | Tenant schema, temp-credential capability |
| **`flux db gui-config`** | Static GUI copy | Add **`--create-temp-credentials`** for live password |
| **`flux db tunnel`** | Tunnel + GUI config | Tunnel + temp creds + one-time password in output |
| **`flux db shell`** | **`psql`** via tunnel | Temp role + **`--command 'SELECT 1'`** for smoke |
| **`flux db dump --schema-only`** | — (use **`flux backup create`**) | Schema-scoped **`pg_dump`** via tunnel; full data may fail on RLS |
| **`flux db restore`** | **`pg_restore`** via tunnel (backup gate) | **Refused** for production pooled schemas |
| **`flux db password`** | Raw Postgres password | Error with tunnel guidance |

#### Password handoff UX (important)

| Context | Behavior |
|---------|----------|
| **`flux db tunnel` (v1)** | GUI block says **`Password: run \`flux db password …\``** — no secret in tunnel output. |
| **`flux db tunnel` (v2)** | One-time temp password shown when credentials are created. |
| **`flux project credentials --field postgres.password`** | stdout = password only (scriptable). |
| **Audit** | v2 temp credential issuance logged in **`project_db_access_audit_events`** (no plaintext password stored). |

#### Operator smoke

```bash
# Unit tests always; live probes when token + project slug/hash set:
FLUX_API_TOKEN=… \
FLUX_DB_ACCESS_SMOKE_SLUG=flux-app-foundry FLUX_DB_ACCESS_SMOKE_HASH=5774112 \
FLUX_DB_ACCESS_SMOKE_V1_SLUG=yeastcoast FLUX_DB_ACCESS_SMOKE_V1_HASH=ffca33f \
FLUX_DB_ACCESS_SMOKE_TUNNEL=1 FLUX_DB_ACCESS_SMOKE_DUMP=1 \
FLUX_DB_ACCESS_SMOKE_SHELL=1 FLUX_DB_ACCESS_SMOKE_RESTORE_GATE=1 \
./bin/db-access-smoke.sh
```

Requires local **`psql`**, **`pg_dump`**, **`pg_restore`**, and SSH to **`FLUX_DB_TUNNEL_SSH_HOST`**.

User-facing guide (dashboard): [**Private database access**](./docs/pages/guides/database-access.md) → `/docs/guides/database-access`.

### Legacy local-Docker CLI table (v1-centric)

These commands predate the Bearer control-plane API; many now have **`/api/cli/v1`** equivalents when **`flux login`** is configured:

| Command | Purpose |
|---------|---------|
| **`create <name>`** | Provision Postgres + PostgREST + Traefik labels (default: CORS + **`/rest/v1`** strip). **`--no-supabase-rest-path`** omits strip on the tenant router. |
| **`push <file> -p, --project <name>`** | Apply a `.sql` file via **`ProjectManager.importSqlFile`** (Docker API: upload + **`psql -f`** inside the tenant DB container); optional **`-s` / `--supabase-compat`**, **`--disable-api-rls`**, **`--no-sanitize`**; reload PostgREST afterward. |
| **`db-reset -p, --project <name> -y, --yes`** | Drop **`public`** + **`auth`**, recreate **`public`**, reapply **`BOOTSTRAP_SQL`** (clean slate before a full dump import). |
| **`list`** | List projects from **`flux-*-db` / `flux-*-api`** containers: slug, combined status, **API URL** (`http://<slug>.flux.localhost`). |
| **`stop <name>`** | Stop API container, then DB. |
| **`start <name>`** | Start DB, then API. |
| **`nuke <name> -y, --yes`** | **Irreversible:** remove both containers and delete **`flux-<slug>-db-data`**. Requires **`--yes`**. |
| **`supabase-rest-path -p, --project <name> [--off]`** | Recreate the API container with updated Traefik strip (**`/rest/v1`**) labels; **`--off`** removes strip from the chain (CORS remains). |
| **`env set <key=value...> -p, --project <name>`** | Merge variables into the **PostgREST** container env and recreate the container. |
| **`env list -p, --project <name>`** | Show env keys; **values omitted** for keys classified as sensitive. |
| **`reap --hours <n>`** | Stop tenant stacks whose **`flux-system.projects.last_accessed_at`** is older than **`n`** hours (**`flux-system`** slug excluded). Run on a schedule (e.g. systemd timer) on the host. |

### Examples

```bash
pnpm run flux -- create "ACME Corp"
pnpm run flux -- push ./migrations/001_init.sql --project "ACME Corp"
pnpm run flux -- env set STRIPE_PUBLISHABLE_KEY=pk_test_xxx APP_URL=http://localhost:3000 --project "ACME Corp"
pnpm run flux -- env list --project "ACME Corp"
pnpm run flux -- list
pnpm run flux -- stop "ACME Corp"
pnpm run flux -- start "ACME Corp"
pnpm run flux -- nuke "ACME Corp" --yes
pnpm run flux -- reap --hours 72
```

### Run SQL quickly on v1 dedicated

When you just need a quick update, you have two safe paths:

- **Tracked file path (recommended for repeatability):**
  - write SQL in a file, then run `flux push ./change.sql -p <slug> --hash <hash>`
- **One-off terminal path (fast ad-hoc):**
  - **`flux db shell <slug> --hash <hash> -c "SELECT …"`** through the SSH tunnel, or
  - **`flux db password <slug> --hash <hash>`** + local **`psql`** to **`127.0.0.1`** while **`flux db tunnel`** runs

### Backups

Before destructive SQL (`DROP`, irreversible `ALTER`, broad deletes), create and verify a backup first:

```bash
flux backup create -p <slug> --hash <hash>
flux backup verify -p <slug> --hash <hash> --latest
```

Backup trust model:

- Backups are only trustworthy after restore verification.
- Artifact validation only checks that the backup file exists and is non-empty.
- Restore verification runs `pg_restore` in a disposable database.

**v2_shared (pooled):** `flux backup create` stores a **portable tenant export** — `pg_dump -Fc` scoped to your `t_<shortId>_api` schema only (not the whole shared cluster). Same CLI commands and restore-verification loop; the catalog row is labeled `tenant_export`. Shared-cluster DR remains an operator concern.

#### Restore-verified gate (destructive actions)

Flux refuses **project delete**, **factory reset**, **`flux nuke`**, **`flux migrate`** (non–dry-run), **`flux db-reset`**, and **`flux db restore`** unless the **newest** backup is **restore-verified** (complete row + `artifact_valid` + `restore_verified`, or a successful verify run). The control plane returns **HTTP 412** with remediation text when the gate blocks an API call.

| Surface | Remediation in UI / CLI |
|---------|-------------------------|
| **Dashboard** (`/projects` → project detail) | **Database** tools: create backup → **Verify latest**. **Delete** and **Factory reset** stay disabled until trust is **restorable**; modals explain why and link to Database tools. The API still enforces **412** if something bypasses the UI. |
| **CLI** | `flux backup create && flux backup verify --latest` (same as SQL workflows above). Override only when you accept no recovery path: `--skip-backup-check` on **`nuke`**, **`migrate`**, **`db-reset`**; dashboard delete/reset: `?skipBackupCheck=true` (not exposed in the main UI). |

Typical operator flow:

1. Open the project in the dashboard (or use CLI with `-p` / `--hash`).
2. `flux backup create` (or dashboard **Create backup**).
3. `flux backup verify --latest` (or dashboard **Verify latest**).
4. Confirm trust shows **restorable**, then run delete / reset / `nuke` / migrate.

Implementation: shared classification in `@flux/core/backup-trust`; server gate in `apps/dashboard/src/lib/destructive-backup-gate.ts`; dashboard client hook `apps/dashboard/src/lib/project-backup-trust-client.ts`.

Full Sarah-friendly walkthrough: [`docs/guides/flux-v1-dedicated-sql-workflows.md`](./docs/guides/flux-v1-dedicated-sql-workflows.md). On [flux.vsl-base.com](https://flux.vsl-base.com/docs/guides/v1-dedicated-sql-workflows), the rendered page lives under **Guides → V1 dedicated quick SQL** (source: `docs/pages/guides/v1-dedicated-sql-workflows.md`).

---

## Security and operations

### Operations audit (self-hosted)

Read-only health pass for the Docker host (containers, schedulers, backups, disk). SSH defaults match **`bin/sync-env-remote.sh`** / **`bin/use-remote-docker-hetzner.sh`** (`root@178.104.205.138`, repo on server at **`/srv/platform/flux`**).

```bash
# Weekly — control plane + logs + disk
./bin/ops-audit.sh --remote

# Monthly — backup trust rows in flux-system + tenant edge smoke
./bin/ops-audit.sh --remote --deep --smoke
```

| Flag | What it checks |
|------|----------------|
| *(default)* | Core containers, `flux-web` log errors, backup volume size, gateway `/health`, stale exited `flux-*` containers |
| `--deep` | Latest `project_backups` per slug (`restore=pending` warns) |
| `--smoke` | `GET http://127.0.0.1/` with `Host: api--<slug>--<hash>.<domain>` via Traefik (301/200 = edge routing). For **v2_shared**, gateway **401** without Bearer = expected auth challenge (OK); **404** = catalog miss (FAIL). |

**Smoke targets:** copy **`bin/ops-audit-smoke.projects.example`** → **`bin/ops-audit-smoke.projects`** (one `slug:hash[:mode[:lifecycle]]` per line), set **`FLUX_OPS_SMOKE_PROJECTS`**, or omit the file to probe every catalog project except `flux-system` / `static`.

**Edge log rotation:** Traefik (`flux-gateway`) and Node gateway (`flux-node-gateway`) use Docker `json-file` limits (`20m` × 5 files) in **`docker/traefik/docker-compose.yml`** and **`packages/gateway/docker-compose.yml`**. Recreate containers after pull to apply: `docker compose -f docker/traefik/docker-compose.yml up -d` and `./bin/deploy-gateway.sh` (or `FLUX_DEPLOY_RESTART_ONLY=1`).

**Host cron:** Backups and fleet monitoring run inside **`flux-web`**. A host **`flux reap`** crontab is optional (idle project stop only); absence is not a failure when `flux-web` is running.

Nightly v1 backups stay **`restore=pending`** until you run **`flux backup verify`** — the deep audit reminds you; see [Backups](#backups) (restore-verified gate) above.

### Pooled migration ledger upgrade

On **v2_shared**, versioned migration history lives in **`flux.flux_migrations`** keyed by **`(tenant_schema, version)`** so tenants on the same Postgres cluster do not share ledger rows. Fleets provisioned before Pass 1B may still have a **legacy global ledger** (primary key on **`version` only**). Directory **`flux push`** lists that table before applying files; if legacy rows exist, Flux **fails closed** rather than guessing which tenant they belong to.

| Ledger state | Operator action |
|--------------|-----------------|
| Table missing | None — first push creates tenant-scoped ledger |
| Legacy table, **0 rows** | None — next directory push auto-upgrades |
| Legacy table **with rows** | Run **`bin/migrate-pooled-ledger.sh`** with **`--assign-legacy-to`** set to the tenant those rows belong to |
| Already tenant-scoped | Script exits OK |

```bash
# On the Flux host (repo at /srv/platform/flux), after deploy:
./bin/migrate-pooled-ledger.sh --assign-legacy-to t_744b22df8382_api --dry-run
./bin/migrate-pooled-ledger.sh --assign-legacy-to t_744b22df8382_api
```

The script uses **`FLUX_SHARED_POSTGRES_URL`** (or **`docker/web/.env`**) and prefers **`psql`** inside the **`flux-web`** container when it is running. **`--assign-legacy-to`** must match **`t_<shortId>_api`** for the project whose migrations were recorded in the legacy ledger—do not use it when rows might belong to multiple tenants.

After the structural upgrade, migrations applied earlier via **single-file push** (before directory listing ran ledger ensure) may still be missing ledger rows. Run **`flux push migrations/ --plan`** per project; insert matching checksum rows manually only when SQL is already applied and push would otherwise re-run DDL.

See also [`docs/pages/guides/migrations.md`](./docs/pages/guides/migrations.md) (operator subsection) and [`plans/security/pass-1-summary.md`](./plans/security/pass-1-summary.md).

- **Secrets** — Postgres password and `PGRST_JWT_SECRET` are generated at provision time (unless overridden for JWT). Treat shell history and logs as sensitive.
- **Dashboard projects** — `GET /api/projects` reads **`flux-system.projects`** first, then resolves Docker status with **`getProjectSummariesForSlugs`** (per-slug inspects, not a full container list). It does not return DB URIs or API keys; use `GET /api/projects/[slug]/credentials` to reveal them. **Repair** uses `POST /api/projects/[slug]/repair`. See **`docs/production-security-audit.md`**.
- **Idle RAM (reaper)** — Catalog column **`last_accessed_at`** is updated by **`POST /api/projects/[slug]/activity`** (SDK **`activity`** option). Schedule **`flux reap --hours …`** on the server to **`stopProject`** for rows past the threshold.
- **`.gitignore`** — excludes `.env*`, `node_modules`, and build artifacts; do not commit tenant credentials.
- **Docker socket** — access to the socket is effectively **root on the host**; restrict who runs the control plane and where.
- **Tenant env listing** — `flux env list` intentionally hides values for keys matching common secret patterns; do not rely on it as a full secret scanner.

---

## AGENTS.md (v2_shared client apps)

Root **[`AGENTS.md`](./AGENTS.md)** is the short operator/agent checklist for **external** applications (Next.js, workers, etc.) calling **pooled `v2_shared`** PostgREST: correct **API hostnames** (short vs triple-dash), **tenant API schema** (`t_<shortId>_api`), **`Accept-Profile` / `Content-Profile`** when not using the Node gateway, **JWT + RLS + `GRANT`**, **TLS** trust from Node, **`flux.json`** ergonomics, and **Auth.js** secrets. Update it whenever we fix a recurring integration footgun.

---

## Docs and guides

Rendered on the dashboard at **`https://flux.vsl-base.com/docs/`** (source: **`docs/pages/`**, built into **`flux-web`** at deploy time).

| Doc | Path on site | Source |
|-----|----------------|--------|
| **Private database access** | `/docs/guides/database-access` | [`docs/pages/guides/database-access.md`](./docs/pages/guides/database-access.md) |
| **Backups workflow** | `/docs/guides/backups` | [`docs/pages/guides/backups.md`](./docs/pages/guides/backups.md) |
| **Migrations** | `/docs/guides/migrations` | [`docs/pages/guides/migrations.md`](./docs/pages/guides/migrations.md) |
| **Next.js + Flux** | `/docs/guides/nextjs` | [`docs/pages/guides/nextjs.md`](./docs/pages/guides/nextjs.md) |
| **CLI reference** | `/docs/reference/cli` | [`docs/pages/reference/cli.md`](./docs/pages/reference/cli.md) |
| **Flux v2 architecture** | `/docs/architecture/flux-v2-architecture` | [`docs/pages/architecture/flux-v2-architecture.md`](./docs/pages/architecture/flux-v2-architecture.md) |

Developer stubs in repo root / `docs/` (not all rendered directly):

- **`AGENTS.md`** (repo root) — v2_shared **client-app** pitfalls; keep in sync with [`docs/pages/guides/nextjs.md`](./docs/pages/guides/nextjs.md).
- **`docs/database-access.md`** — operator/dev index for private DB access (points at canonical guide + README section).
- **`docs/production-security-audit.md`** — Production security posture, pinned images, and credential API behavior.
- **`docs/guides/postgresql-import-to-flux.md`** — Version mismatches, **`flux push`** flags, Supabase **`createClient`** **`db.schema: "api"`**, and operator hygiene for full dumps.  
- **`docs/guides/flux-v1-dedicated-sql-workflows.md`** — Sarah-friendly quick SQL updates on v1 dedicated projects (`flux push` + direct `psql`).
- **`docs/pages/guides/clerk.md`** — Aligning Clerk JWTs with PostgREST’s **`PGRST_JWT_SECRET`** and the dashboard. Renders at `/docs/guides/clerk`.
- **`docs/pages/guides/authjs.md`** — Follow-on guide for Auth.js integration and user-scoped RLS (`auth.uid()` + `text` user ids). Renders at `/docs/guides/authjs`.
- **`docs/UI-SCOPE-CONTRACT.md`** — CLI-first UI boundary, admission criteria, and scheduled scope revisit protocol.
- **`docs/TRAJECTORY-TODO.md`** — internal execution roadmap and active priority backlog.

---

## Trajectory TODOs (internal)

The canonical backlog lives in:

- `docs/TRAJECTORY-TODO.md`

Operational policy:

- Keep it **ranked by priority** (`P0`–`P3`).
- Every item must include:
  - owner
  - status
  - rationale / risk
  - acceptance criteria
- Update it after each meaningful deploy or architecture change.
- If README and TODO doc diverge, treat `docs/TRAJECTORY-TODO.md` as the active source and reconcile immediately.

---

## Contributing mindset

Prefer **small, strict TypeScript** functions, **explicit Docker** calls, and **visible progress** for long operations (image pulls, Postgres boot). When in doubt, add a clear log line instead of a silent hang.

Welcome to the control plane.
