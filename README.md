# Flux

**Flux** is a slim **Backend-as-a-Service (BaaS)** / **Database-as-a-Service (DBaaS)** platform. Each **project** is an isolated **tenant bucket**: a dedicated **PostgreSQL** container with durable storage and a **PostgREST** container that exposes your `api` schema as a **REST API** without hand-written CRUD servers.

The goal is to make it straightforward to run **many isolated backends** on a **Docker host**—with a **control-plane** (CLI + optional Next.js dashboard) that provisions networks, containers, volumes, and bootstrap SQL in a repeatable way. Long-term, you can layer **auth**, **billing**, and **routing** without adopting a full managed platform like Supabase on day one.

---

## Table of contents

- [What ships in this repo](#what-ships-in-this-repo)
- [Architecture at a glance](#architecture-at-a-glance)
- [Monorepo layout](#monorepo-layout)
- [Core concepts](#core-concepts)
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
| **`@flux/core`** | Docker orchestration: networks, gateway, per-tenant Postgres + PostgREST, bootstrap SQL, migrations, JWT helpers, **environment updates** on the API container. |
| **`@flux/cli`** | Operator-facing `flux` commands (`create`, `push`, `list`, `start`/`stop`, `nuke`, **`env`**, …). |
| **`@flux/sdk`** | Small TypeScript client over PostgREST-style HTTP (table queries, anon key headers). |
| **`apps/dashboard`** | Next.js **control-plane UI**: GitHub sign-in, project list/create, container lifecycle, JWT/Clerk-style secrets, **Stripe** checkout/webhook hooks, all backed by a **`flux-system`** database. |

Everything assumes **one Docker Engine** (local socket or `DOCKER_HOST`) and **pnpm** workspaces.

---

## Architecture at a glance

### Control plane vs data plane

- **Control plane** — Node processes (CLI, Next.js server) that call the Docker API and, for the dashboard, talk to **`flux-system`** Postgres on a published host port. It decides *what* runs, not tenant query traffic at scale.
- **Data plane** — Each tenant’s **Postgres** (data) and **PostgREST** (HTTP API). App traffic hits PostgREST (via Traefik), not the Next.js app.

### Docker resources (names are stable conventions)

| Resource | Purpose |
|----------|---------|
| **`flux-network`** | User-defined bridge (`FLUX_NETWORK_NAME`). Tenant DB + API containers attach here; the **Traefik** gateway uses the same network so it can route to backends by container labels. |
| **`flux-gateway`** | Traefik (`FLUX_GATEWAY_CONTAINER_NAME`) — Docker provider, read-only socket mount, listens on **host :80**, discovers routers from **labels** on the PostgREST containers. |
| **`flux-<slug>-db`** | Postgres 16 (Alpine), named volume **`flux-<slug>-db-data`**, published random host port **`5432`** for host-side tools and migrations. |
| **`flux-<slug>-api`** | PostgREST — **no** random public port; Traefik sends **`http://<slug>.flux.localhost`** to port **3000** inside the network. |

Provisioning (`ProjectManager.provisionProject`) ensures the network exists, ensures the gateway image is present and running, creates the volume and Postgres container, runs **`BOOTSTRAP_SQL`**, then creates the PostgREST container with Traefik labels so **`http://<slug>.flux.localhost`** resolves (with `/etc/hosts` or DNS for `*.flux.localhost`).

### HTTP path to a tenant API

1. Client requests **`http://myapp.flux.localhost/...`** (Host header matches Traefik router rule).
2. **Traefik** on `flux-network` forwards to the **`flux-myapp-api`** container’s port **3000**.
3. **PostgREST** connects to **`flux-myapp-db:5432`** using **`PGRST_DB_URI`** (internal DNS).

### Schema changes and cache reload

After SQL runs from the host (`executeSql`, `importSqlFile`, or `flux push`), Flux runs `NOTIFY pgrst, 'reload schema'` in Postgres, waits briefly, then sends **SIGUSR1** to the **`flux-<slug>-api`** container so PostgREST reloads its schema cache. (This matches PostgREST’s documented signal behavior; do not assume **SIGHUP** for schema cache.)

---

## Monorepo layout

The workspace is defined in **`pnpm-workspace.yaml`** (`packages/*`, `apps/*`). Dependencies use **`workspace:*`** so local packages link without publishing.

| Path | Package | Responsibility |
|------|---------|------------------|
| `packages/core` | **`@flux/core`** | `ProjectManager`, Docker + volume + network + gateway, `BOOTSTRAP_SQL`, `pg` against published ports, PostgREST reload signaling, `setProjectEnv` / `listProjectEnv`, JWT key derivation from `PGRST_JWT_SECRET`. |
| `packages/cli` | **`@flux/cli`** | `flux` entry (`src/index.ts`), Commander + Chalk, calls into `ProjectManager`. |
| `packages/sdk` | **`@flux/sdk`** | `createClient`, `FluxClient`, PostgREST-shaped `select`/`insert`/`update`/`delete` + `eq` filters over `fetch`. |
| `apps/dashboard` | **`dashboard`** (private) | Next.js App Router, Auth.js, Drizzle + `pg` to `flux-system`, API routes under `app/api/*`, Stripe integration, `instrumentation.ts` for DB init. |
| `docs/guides/` | — | Extra integration guides (e.g. Clerk + PostgREST). |

Root **`package.json`** is minimal; install and scripts are usually run with **`pnpm --filter <name>`** from the repo root.

---

## Core concepts

### Project name and slug

User-facing names are **slugified** for container and volume names (lowercase, hyphen-separated). The CLI and dashboard accept display names; Docker objects always use the slug (e.g. **`my-app`** → `flux-my-app-db`).

### Bootstrap SQL (`BOOTSTRAP_SQL`)

On first connection to a new tenant DB, Flux runs SQL that:

- Creates schema **`api`** (PostgREST exposes this via `PGRST_DB_SCHEMA`).
- Creates roles **`authenticator`**, **`anon`**, **`authenticated`** and grants appropriate privileges so PostgREST’s JWT role model works.

### JWTs and keys

PostgREST verifies JWTs with **`PGRST_JWT_SECRET`**. The dashboard (and `getProjectKeys` in core) can derive **anon** and **service_role**-style keys from the same secret for client tooling. You can align this secret with an external issuer (e.g. Clerk); see **`docs/guides/clerk-integration.md`**.

### Tenant environment variables (“project bucket”)

The **PostgREST container** carries all runtime env: built-in `PGRST_*` variables plus **custom** keys (Stripe, public URLs, etc.). **`ProjectManager.setProjectEnv`** merges new keys into the existing container env and **recreates** the API container (same image, Traefik labels, network, limits) so changes apply. The CLI exposes this as **`flux env set`** / **`flux env list`** (list hides values for sensitive key names—see `isFluxSensitiveEnvKey` in `@flux/core`).

---

## Packages deep dive

### `@flux/core` (`packages/core`)

- **Exports** — `ProjectManager`, `FLUX_NETWORK_NAME`, `FLUX_GATEWAY_CONTAINER_NAME`, `FLUX_DOCKER_IMAGES`, `fluxApiUrlForSlug`, `BOOTSTRAP_SQL`, helpers like `isFluxSensitiveEnvKey`, and types (`FluxProject`, `FluxProjectSummary`, `FluxProjectEnvEntry`, …).
- **Docker** — `dockerode`; pulls with stall detection; idempotent network/gateway provisioning.
- **Typical flows** — `provisionProject`, `listProjects`, `stopProject` / `startProject`, `nukeProject`, `getPostgresHostConnectionString`, `executeSql`, `importSqlFile`, `updatePostgrestJwtSecret` (delegates to `setProjectEnv`), `setProjectEnv`, `listProjectEnv`, `getProjectKeys`.

### `@flux/cli` (`packages/cli`)

- Entry: **`packages/cli/bin/flux`** (runs the TypeScript entry via `tsx` for development).
- Uses **Commander** for subcommands, **Chalk** for output.

### `@flux/sdk` (`packages/sdk`)

- Minimal **PostgREST client**: base URL + optional anon JWT as `apikey` / `Authorization` bearer.
- **Not** a full query builder—enough for app code to hit tables in the `api` schema with filters like `eq`.

---

## Dashboard (`apps/dashboard`)

The dashboard is the first **product UI** on top of `@flux/core`.

| Piece | Role |
|-------|------|
| **Next.js (App Router)** | UI under `app/`, Route Handlers under `app/api/`. |
| **`instrumentation.ts`** | On Node server start, imports **`initSystemDb()`** — provisions or starts the **`flux-system`** Docker project and ensures Drizzle/Auth tables exist. Logs **`[flux] System DB ready.`** or a clear failure if Docker is unreachable. |
| **`proxy.ts`** | Wraps **Auth.js** `auth` with a **matcher** for **`/projects/:path*`** (auth protection for the projects area). |
| **Auth.js (`next-auth` v5)** | GitHub OAuth; sessions persisted via **`@auth/drizzle-adapter`** into **`flux-system`**. |
| **Drizzle + `pg`** | Schema in `src/db/schema.ts`; migrations can be managed with `drizzle-kit` if you adopt it. |
| **`@flux/core`** | `getProjectManager()` provisions tenant projects and drives start/stop/JWT/env updates from API routes (`app/api/projects/...`). |
| **Stripe** | `app/api/billing/checkout` and `app/api/billing/webhook` — billing hooks at the application layer; tenant data still lives in per-project Postgres. |

### Dashboard environment variables

Typical **`apps/dashboard/.env.local`** (never commit; root `.gitignore` covers `.env*`):

- **`AUTH_SECRET`** (or **`NEXTAUTH_SECRET`**) — session signing.
- **`GITHUB_ID`** / **`GITHUB_SECRET`** (or **`AUTH_GITHUB_ID`** / **`AUTH_GITHUB_SECRET`**) — GitHub OAuth.
- **`AUTH_URL`** or **`NEXTAUTH_URL`** — public base URL (e.g. `http://localhost:3000`) for OAuth redirects.

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
| **`create <name>`** | Provision Postgres + PostgREST + Traefik labels; print Postgres URL (host) and tenant API base URL. |
| **`push <file> -p, --project <name>`** | Stream a `.sql` file into the tenant DB via the published port; reload PostgREST schema afterward. |
| **`list`** | List projects from **`flux-*-db` / `flux-*-api`** containers: slug, combined status, **API URL** (`http://<slug>.flux.localhost`). |
| **`stop <name>`** | Stop API container, then DB. |
| **`start <name>`** | Start DB, then API. |
| **`nuke <name> -y, --yes`** | **Irreversible:** remove both containers and delete **`flux-<slug>-db-data`**. Requires **`--yes`**. |
| **`env set <key=value...> -p, --project <name>`** | Merge variables into the **PostgREST** container env and recreate the container. |
| **`env list -p, --project <name>`** | Show env keys; **values omitted** for keys classified as sensitive. |

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
```

---

## Security and operations

- **Secrets** — Postgres password and `PGRST_JWT_SECRET` are generated at provision time (unless overridden for JWT). Treat shell history and logs as sensitive.
- **`.gitignore`** — excludes `.env*`, `node_modules`, and build artifacts; do not commit tenant credentials.
- **Docker socket** — access to the socket is effectively **root on the host**; restrict who runs the control plane and where.
- **Tenant env listing** — `flux env list` intentionally hides values for keys matching common secret patterns; do not rely on it as a full secret scanner.

---

## Docs and guides

- **`docs/guides/clerk-integration.md`** — Aligning Clerk JWTs with PostgREST’s `PGRST_JWT_SECRET` and the dashboard.

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
