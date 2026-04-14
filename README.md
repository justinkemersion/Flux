# Flux

**Flux** is a slim, high-performance **Backend-as-a-Service (BaaS)** and **Database-as-a-Service (DBaaS)** platform. Each *project* is a self-contained **tenant bucket**: a dedicated **PostgreSQL** instance with durable storage and a **PostgREST** front door that turns your schema into a **REST API** without hand-written CRUD servers.

The long-term vision is to make it trivial to stand up isolated backends for **multi-tenant web applications**, then layer on **dashboards**, **routing**, **authentication**, and **billing** (e.g. **Stripe**) without operating a full managed control plane like Supabase at day one. Flux optimizes for **small teams**, **predictable resource use**, and **minimal moving parts**—Docker on a single host (or a small fleet) instead of a sprawling Kubernetes estate.

---

## High-level intent

| Goal | How Flux approaches it |
|------|-------------------------|
| **Isolation** | One Postgres container + one PostgREST container per project, on a shared user-defined bridge network, with named volumes for data. |
| **Speed to API** | PostgREST reflects the `api` schema over HTTP as soon as Postgres and roles exist. |
| **Operator ergonomics** | `@flux/core` encapsulates Docker + DB wiring; `@flux/cli` exposes a small verb set for day-two operations. |
| **Path to product** | Same primitives can later be driven by a **Next.js dashboard**, **Traefik** host rules, and an **auth** layer—without re-architecting the tenant model. |

Flux is deliberately **not** a hosted multi-region PaaS in v1. It is an **engineering-first control plane**: you run Docker where you want tenants to live, and Flux orchestrates containers, networks, volumes, and bootstrap SQL in a repeatable way.

---

## The Lego blocks (tech stack)

### pnpm workspaces

The repository is a **pnpm monorepo** (`pnpm-workspace.yaml` includes `packages/*` and `apps/*`). Workspace packages share a single lockfile, fast installs, and `workspace:*` links between `@flux/core`, `@flux/cli`, and future `apps/*` without publishing to npm for local development.

**Why:** strict boundaries between **orchestration logic** (`@flux/core`), **operator UX** (`@flux/cli`), and **product surfaces** (dashboard, marketing, etc.) while keeping one TypeScript toolchain and one `pnpm install` at the root.

### Docker and dockerode (orchestration without Kubernetes)

**Docker** is the runtime boundary: images, networks, published ports, and volumes. **`dockerode`** is the Node.js client for the Docker Engine API.

**Why not Kubernetes (yet):** Kubernetes excels at fleet scale, RBAC across clusters, and long-running reconcilers—but it carries **control-plane weight**, YAML sprawl, and a learning curve that dominates small projects. Flux targets a **slim** deployment model: a Docker host (VM, bare metal, or a single cloud instance) with the Engine API and socket access. `ProjectManager` in `@flux/core` is the reconciler: idempotent-ish network creation, image pulls, container lifecycle, and volume attachment.

This is a conscious trade-off: you gain **simplicity and debuggability**; you accept **single-host scaling** until you introduce an external scheduler or split the control plane.

### PostgreSQL (`postgres:16-alpine`)

Each tenant gets a **Postgres 16** container (`flux-<slug>-db`). Credentials are generated at provision time; data lives on a **Docker named volume** (`flux-<slug>-db-data`) mounted at `/var/lib/postgresql/data` so restarts and image upgrades do not wipe the database files.

**Why Alpine:** smaller images, faster pulls, fewer packages—aligned with the “slim” mandate.

### PostgREST (`postgrest/postgrest:latest`)

**PostgREST** connects to Postgres with a database role and exposes tables and views in a configured schema as **HTTP resources**. It is the “magic” **on-the-fly REST API**: you evolve the schema (via migrations), and the API surface tracks it—subject to caching behavior (see below).

Flux wires **internal URI** (`PGRST_DB_URI`), **JWT secret**, **`PGRST_DB_SCHEMA=api`**, and **`PGRST_DB_ANON_ROLE=anon`** after bootstrap roles exist.

### Commander, Chalk, and Zod (`@flux/cli`)

| Piece | Role |
|-------|------|
| **Commander** | Subcommands, options, and `--help` for the `flux` CLI. |
| **Chalk** | Semantic coloring (progress, success, errors) for terminal output. |
| **Zod** | Present in the CLI package for **runtime validation** of inputs and future structured config; the CLI is structured so flags and payloads can be validated without trusting raw strings alone. |

Together they keep the operator interface **discoverable** and **professional** without pulling in a heavy TUI framework.

### `pg` (node-postgres)

**`pg`** connects from the **host** to the tenant Postgres **published port** (`localhost:<random 5432>`). That path is used for:

- **`BOOTSTRAP_SQL`** during provision (roles, `api` schema, grants).
- **`executeSql`** for ad-hoc and migration-style SQL pushed from the CLI.

**Why host port:** the control plane runs on the host (Node), not inside the tenant network; connecting via published ports avoids bundling SQL clients into Postgres or PostgREST containers for migrations.

---

## How it works (the magic)

### Boot sequencing

Provisioning is order-sensitive:

1. Ensure **`flux-network`** (user-defined bridge) exists.
2. Ensure the **data volume** and **container images** (pull if missing).
3. Create and start **Postgres** with `POSTGRES_PASSWORD`, volume bind, and **random host port** mapping for `5432/tcp`.
4. **Wait until Postgres accepts connections** before running bootstrap: `waitForPostgresAndRun` loops `pg.Client` connections with **exponential backoff** and a capped attempt count, so first-time data directory initialization does not race PostgREST or bootstrap DDL.
5. Execute **`BOOTSTRAP_SQL`**: creates schema **`api`**, roles **`authenticator`**, **`anon`**, **`authenticated`**, and grants needed for PostgREST’s role model.
6. Create and start **PostgREST** with `PGRST_DB_URI` pointing at **`flux-<slug>-db:5432`** on the **same Docker network** (DNS name = container name).

PostgREST is started with a **restart policy** so short-lived “DB not ready” failures during startup are absorbed without custom health-check daemons in Node.

### Internal networking

- **`flux-network`**: all tenant containers attach with `HostConfig.NetworkMode` set to this network.
- **Postgres ↔ PostgREST**: `PGRST_DB_URI` uses the **internal hostname** `flux-<slug>-db` (Docker’s embedded DNS on user-defined bridges).
- **Operator ↔ Postgres**: the CLI and `pg` use **`localhost:<published>`** for the mapped `5432/tcp` port so migrations and `executeSql` work from the host.

Random host ports (`HostPort: "0"`) avoid collisions between projects and keep the surface area explicit: each tenant’s Postgres and API are reachable on distinct host ports for debugging and local tools.

### Schema caching and migrations

PostgREST **caches schema metadata** for performance. After raw SQL runs (e.g. `flux push`), **`executeSql`** sends **`SIGHUP`** to the **`flux-<slug>-api`** container via Docker’s kill API with `signal: SIGHUP`, which triggers PostgREST to **reload its schema cache** without a full container restart. Missing or stopped API containers result in a **no-op** for the signal step so a successful migration is not failed if PostgREST is absent.

> **Alternative (not implemented by default):** PostgreSQL `NOTIFY` channels can drive reloads when PostgREST is configured to listen—useful at scale. Flux defaults to **SIGHUP** for simplicity and reliability in a slim build.

---

## Repository layout (current)

| Path | Package | Responsibility |
|------|---------|----------------|
| `packages/core` | **`@flux/core`** | `ProjectManager`, Docker orchestration, `BOOTSTRAP_SQL`, `pg` execution, PostgREST reload signaling. |
| `packages/cli` | **`@flux/cli`** | `flux` CLI entry (`src/index.ts`), Commander + Chalk. |
| `apps/*` | (reserved) | Future **Next.js dashboard** and other product apps. |

---

## Prerequisites

- **Node.js** (LTS or current; repo uses modern ESM + TypeScript).
- **pnpm** (see root `packageManager` in `package.json`).
- **Docker Engine** running locally (or remote socket via `DOCKER_HOST` if you configure dockerode accordingly).

---

## Quick start

```bash
# From repository root
pnpm install

# Run the CLI (from the cli package)
cd packages/cli
pnpm run flux -- --help
```

You can also use the **`flux`** bin after linking (`packages/cli/bin/flux` invokes `tsx` on `src/index.ts`).

---

## CLI reference

All commands are implemented in **`@flux/cli`** (`packages/cli/src/index.ts`). They delegate orchestration to **`ProjectManager`** in **`@flux/core`**.

| Command | Purpose |
|---------|---------|
| **`create <name>`** | Provision Postgres + PostgREST for a new project; prints connection URL and API base URL. |
| **`push <file> -p, --project <name>`** | Read a `.sql` file and execute it against the project’s Postgres via the published host port; reloads PostgREST schema cache on success. |
| **`list`** | List Flux projects derived from `flux-*-db` / `flux-*-api` containers (all states); shows **slug**, **combined status**, and **API host port** when known. |
| **`stop <name>`** | Stop API then DB containers. |
| **`start <name>`** | Start DB then API containers. |
| **`nuke <name> -y, --yes`** | **Irreversible:** force-remove both containers and delete the **`flux-<slug>-db-data`** volume. Requires **`--yes`**. |

### Examples

```bash
# Create a tenant named "acme-corp" (slugified for container names)
pnpm run flux -- create "ACME Corp"

# Apply a migration file
pnpm run flux -- push ./migrations/001_init.sql --project "ACME Corp"

# Inspect all Flux-shaped containers
pnpm run flux -- list

# Pause a tenant
pnpm run flux -- stop "ACME Corp"

# Resume
pnpm run flux -- start "ACME Corp"

# Destroy tenant data (requires explicit confirmation)
pnpm run flux -- nuke "ACME Corp" --yes
```

---

## Configuration and security notes

- **Secrets** (generated Postgres password, JWT secret) are printed once on **`create`**; treat terminal history and logs accordingly.
- **`.gitignore`** at the repo root excludes `.env*`, `node_modules`, build artifacts, and other common leakage vectors—**never commit** tenant credentials or production env files.
- **Docker socket access** is equivalent to **root on the host**; restrict who can run Flux and where the control plane runs.

---

## Future roadmap

| Initiative | Description |
|------------|-------------|
| **Next.js dashboard** | Server-driven UI over the same `ProjectManager` primitives: project list, detail, start/stop, guarded nuke, and links to PostgREST—initially co-located with Docker for simplicity. |
| **Traefik and subdomain routing** | Dynamic labels per tenant API container so `https://<project>.api.example.com` routes to the correct PostgREST instance without maintaining static Nginx configs. |
| **Auth and multi-user apps** | JWT validation already has a hook via `PGRST_JWT_SECRET`; future work includes issuer integration, row-level policies, and dashboard login—without abandoning the per-tenant container model. |
| **Billing (Stripe)** | Out of scope for the engine itself; the intended pattern is to attach Stripe webhooks and customer metadata at the **application** layer, using Flux tenants as isolated data planes per customer or per app. |

---

## Contributing mindset

Flux optimizes for **clarity over cleverness**: small functions, strict TypeScript, explicit Docker calls, and operator-visible progress for long-running steps. When in doubt, prefer **one more log line** over a silent hang, and **one explicit Docker primitive** over a hidden sidecar.

Welcome to the control plane.
