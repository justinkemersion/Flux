# Operator reference: dashboard behavior by runtime mode

**Audience:** Flux operators and dashboard contributors.  
**Status:** internal / operator-only  
**Canonical product overview:** [README.md](../README.md) · [Pooled vs dedicated](./pages/concepts/pooled-vs-dedicated.md)

Every project row in `flux-system.projects` carries a `mode` column (`v1_dedicated` | `v2_shared` | `NULL`). `NULL` is treated as `v1_dedicated` everywhere. The dashboard branches on this value before touching Docker so that **v2_shared** rows — which never have per-tenant containers — do not generate spurious Docker errors.

## `projects.mode` values

| Value | Meaning |
|-------|---------|
| `v1_dedicated` | Dedicated Docker stack: `flux-<hash>-<slug>-db` + `flux-<hash>-<slug>-api`. All Docker-based operations apply. |
| `v2_shared` | Shared-cluster tenant. No per-tenant containers. Docker operations are skipped or return 4xx/5xx. |
| `NULL` | Legacy row; treated as `v1_dedicated` throughout. |

## API route behavior (v1 vs v2)

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
| `DELETE /api/projects/[slug]` | `nukeProject` (Docker containers + volume) | `deprovisionProject` (drop shared-cluster schema + roles + tenant ledger) |
| `DELETE /api/cli/v1/projects/:hash` (`flux nuke`) | `deleteProjectInfrastructure` (Docker) | `deprovisionProject` (same SQL as dashboard delete). Catalog row is removed only after teardown succeeds. `--force` orphan purge remains Docker-only (no catalog row). |

## Fleet monitor (`apps/dashboard/src/lib/fleet-monitor.ts`)

On every 2-minute tick (`runFleetMonitorTick`) and on the immediate post-create probe (`probeSingleProject`):

- **v1_dedicated** — `getProjectSummariesForSlugs` (Docker inspect batch); if stopped, records `stopped`; otherwise HTTP probes the PostgREST URL and records `running` or `error`.
- **v2_shared** — HTTP probe only (no Docker); records `running` or `error` directly in `projects.health_status`.

`getProjectSummariesForSlugs` is **never called for v2 rows** — the Docker batch only runs when there is at least one v1 project in the catalog.

### v2 probe configuration

Inside `flux-web`, public `https://` probes to tenant API URLs often fail even when tenants are healthy (TLS, ACME, internal DNS). Set in `docker/web/.env`:

```bash
FLUX_TENANT_PROBE_GATEWAY_URL=http://flux-node-gateway:4000
```

Probes then call the internal gateway base URL with `Host: api--<slug>--<hash>.<domain>`. v2 fleet health mints a short-lived project JWT (`jwt_secret` required). See `apps/dashboard/src/lib/tenant-api-probe.ts`.

## `statusFromV2CatalogHealth` (`apps/dashboard/src/lib/v2-project-status.ts`)

Maps `projects.health_status` to the frontend `ServerStatus` type:

| `health_status` | `status` returned |
|-----------------|-------------------|
| `"running"` | `"running"` |
| `"stopped"` | `"stopped"` |
| `"error"` | `"partial"` |
| `NULL` / anything else | `"partial"` |

## UI controls hidden for v2 (`project-card.tsx`, `project-summary-card.tsx`)

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
