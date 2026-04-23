# Flux

**Flux** is a slim **Backend-as-a-Service (BaaS)** / **Database-as-a-Service (DBaaS)** platform. Each **project** is an isolated **tenant bucket**: a dedicated **PostgreSQL** container with durable storage and a **PostgREST** container that exposes your `api` schema as a **REST API** without hand-written CRUD servers.

The goal is to make it straightforward to run **many isolated backends** on a **Docker host**—with a **control-plane** (CLI + optional Next.js dashboard) that provisions networks, containers, volumes, and bootstrap SQL in a repeatable way. Long-term, you can layer **auth**, **billing**, and **routing** without adopting a full managed platform like Supabase on day one.

---

## Table of contents

- [What ships in this repo](#what-ships-in-this-repo)
- [Architecture at a glance](#architecture-at-a-glance)
- [Monorepo layout](#monorepo-layout)
- [Core concepts](#core-concepts)
- [Supabase → Flux (migrations)](#supabase--flux-migrations)
- [Packages deep dive](#packages-deep-dive)
- [Dashboard (`apps/dashboard`)](#dashboard-appsdashboard)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [End-to-end validation](#end-to-end-validation)
- [CLI reference](#cli-reference)
- [Security and operations](#security-and-operations)
- [Docs and guides](#docs-and-guides)
- [Roadmap](#roadmap)
- [Contributing mindset](#contributing-mindset)

---

## What ships in this repo

| Piece | Role |
|-------|------|
| **`@flux/core`** | Docker orchestration: networks, gateway, per-tenant Postgres + PostgREST, bootstrap SQL, **plain-SQL import** (Supabase-aware transforms, `public` → `api` move), JWT helpers, **environment updates** on the API container, Traefik label helpers. |
| **`@flux/cli`** | Operator-facing `flux` commands (`create`, `push`, `db-reset`, `list`, `start`/`stop`, `nuke`, **`env`**, **`supabase-rest-path`**, …). |
| **`@flux/sdk`** | Small TypeScript client over PostgREST-style HTTP (table queries, anon key headers). |
| **`apps/dashboard`** | Next.js **control-plane UI**: GitHub sign-in, project list/create, container lifecycle, JWT/Clerk-style secrets, **Stripe** checkout/webhook hooks, all backed by a **`flux-system`** database. |

Everything assumes **one Docker Engine** (local socket or `DOCKER_HOST`) and **pnpm** workspaces (**pnpm 10.x**, see root `packageManager`).

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

## Monorepo layout

The workspace is defined in **`pnpm-workspace.yaml`** (`packages/*`, `apps/*`). Dependencies use **`workspace:*`** so local packages link without publishing.

| Path | Package | Responsibility |
|------|---------|------------------|
| `packages/core` | **`@flux/core`** | `ProjectManager`, Docker + volume + network + gateway, `BOOTSTRAP_SQL`, tenant Postgres ops via **`docker exec`** (`pg_isready`, `psql`; tar upload for large SQL), PostgREST reload signaling, `setProjectEnv` / `listProjectEnv`, JWT key derivation from `PGRST_JWT_SECRET`. |
| `packages/cli` | **`@flux/cli`** | `flux` entry (`src/index.ts`), Commander + Chalk, calls into `ProjectManager`. |
| `packages/sdk` | **`@flux/sdk`** | `createClient`, `FluxClient`, PostgREST-shaped `select`/`insert`/`update`/`delete` + `eq` filters over `fetch`. |
| `apps/dashboard` | **`dashboard`** (private) | Next.js App Router, Auth.js, Drizzle + `pg` to `flux-system`, API routes under `app/api/*`, Stripe integration, `instrumentation.ts` for DB init. |
| `docs/guides/` | — | **PostgreSQL / Supabase → Flux** import guide, **Clerk + PostgREST**, etc. |

Root **`package.json`** is minimal; install and scripts are usually run with **`pnpm --filter <name>`** from the repo root.

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

PostgREST verifies JWTs with **`PGRST_JWT_SECRET`**. The dashboard (and **`getProjectKeys`** in core) derive **anon** and **service_role**-style JWTs **from the container env only** (same material PostgREST uses). You can align this secret with an external issuer (e.g. Clerk); see **`docs/guides/clerk-integration.md`**.

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

Run the CLI from the package (or link/use the `flux` bin):

```bash
cd packages/cli
pnpm run flux -- --help
```

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

Implementation: **`packages/cli/src/index.ts`**. Orchestration: **`ProjectManager`** in **`@flux/core`**.

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

---

## Security and operations

- **Secrets** — Postgres password and `PGRST_JWT_SECRET` are generated at provision time (unless overridden for JWT). Treat shell history and logs as sensitive.
- **Dashboard projects** — `GET /api/projects` reads **`flux-system.projects`** first, then resolves Docker status with **`getProjectSummariesForSlugs`** (per-slug inspects, not a full container list). It does not return DB URIs or API keys; use `GET /api/projects/[slug]/credentials` to reveal them. **Repair** uses `POST /api/projects/[slug]/repair`. See **`docs/production-security-audit.md`**.
- **Idle RAM (reaper)** — Catalog column **`last_accessed_at`** is updated by **`POST /api/projects/[slug]/activity`** (SDK **`activity`** option). Schedule **`flux reap --hours …`** on the server to **`stopProject`** for rows past the threshold.
- **`.gitignore`** — excludes `.env*`, `node_modules`, and build artifacts; do not commit tenant credentials.
- **Docker socket** — access to the socket is effectively **root on the host**; restrict who runs the control plane and where.
- **Tenant env listing** — `flux env list` intentionally hides values for keys matching common secret patterns; do not rely on it as a full secret scanner.

---

## Docs and guides

- **`docs/production-security-audit.md`** — Production security posture, pinned images, and credential API behavior.
- **`docs/guides/postgresql-import-to-flux.md`** — Version mismatches, **`flux push`** flags, Supabase **`createClient`** **`db.schema: "api"`**, and operator hygiene for full dumps.  
- **`docs/guides/clerk-integration.md`** — Aligning Clerk JWTs with PostgREST’s **`PGRST_JWT_SECRET`** and the dashboard.

---

## Roadmap

| Direction | Notes |
|-----------|--------|
| **Dashboard depth** | More project detail, metrics, logs, and first-class env/JWT editing (partially present via APIs). |
| **Production routing** | Today: **`*.flux.localhost`** via Traefik on the Docker host. Future: TLS, custom domains, and hosted DNS for `https://<project>.api.example.com`. |
| **Auth & RLS** | Dashboard identity is Auth.js on **`flux-system`**; tenant APIs use PostgREST roles from **`BOOTSTRAP_SQL`**. Tighter RLS and claim mapping as apps grow. |
| **Billing** | Stripe routes exist in the dashboard; extend webhooks and plan enforcement as needed. |

---

## Contributing mindset

Prefer **small, strict TypeScript** functions, **explicit Docker** calls, and **visible progress** for long operations (image pulls, Postgres boot). When in doubt, add a clear log line instead of a silent hang.

Welcome to the control plane.
