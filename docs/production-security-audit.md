# Flux production security (architect audit memory)

This document records the **Senior Architect** audit themes and the **implemented** mitigations in-tree. Update it when security posture changes.

## Critical themes (ongoing)

1. **Docker socket** — Traefik uses the Engine API via a mounted socket. Treat socket access as **host-equivalent**; isolate the daemon, restrict operators, consider rootless or remote TLS with strict ACLs.
2. **Control plane trust** — Anyone who can call the dashboard/API with a valid session can provision and manage tenants. Harden Auth.js, rate limits, and deployment network boundaries.
3. **State sync** — Residual gaps: CLI `flux list` still discovers stacks from Docker only; orphan containers without a catalog row are not shown in the dashboard.

### Idle RAM (Flux reaper)

- **`projects.last_accessed_at`** in **`flux-system`** (renamed from **`last_active_at`** on upgrade) tracks the last successful tenant API touch.
- **`@flux/sdk`** can **`POST`** to **`/api/projects/[slug]/activity`** (Bearer **`FLUX_ACTIVITY_SECRET`**) after each successful PostgREST response.
- **`ProjectManager.reapIdleProjects(maxIdleHours)`** stops stacks past the threshold; **`flux reap --hours <n>`** is the operator entrypoint (schedule on the host, e.g. Hetzner).

## Implemented mitigations

### Catalog-first project list (dashboard)

- **`GET /api/projects`** reads **`flux-system.projects`** for the signed-in user, then calls **`ProjectManager.getProjectSummariesForSlugs(slugs)`**, which uses **two container inspects per slug** (no full `docker ps` scan).
- Tenant **status** uses **`fluxTenantStatusFromContainerPair`**: **missing** (no DB or API container), **corrupted** (only one of the two), plus **running** / **stopped** / **partial** when both exist.
- **`POST /api/projects/[slug]/repair`** runs **`nukeContainersOnly`**, then an idempotent **`removeTenantPrivateNetworkAllowMissing`**, then **`provisionProject`** to rebuild a fresh stack when the catalog row exists but Docker is wrong (destructive; same hash preserved). Nuke already removes the private network, but the extra pass avoids stale Docker network state and duplicate name errors on reprovision.

### Tiered networking (tenant isolation)

Customer tenant **Postgres** is on a per-project **internal** bridge (`flux-<hash>-<slug>-net`); it is **not** attached to **`flux-network`**, so other `flux-network` services cannot open TCP to it. **PostgREST** attaches to **both** that private network and **`flux-network`** (Traefik). The **`flux-system`** catalog Postgres is a **known exception**: it stays on the private project network **and** `flux-network` so the Next.js / Drizzle control plane can use `getPostgresHostConnectionString` from a bridge-only container. Tenant Postgres has **no** host `PortBindings`; admin uses **`docker exec`**. Control-plane and operators should treat the connection string the dashboard shows for *tenant* projects as for apps co-located on the private link or for exec, not for arbitrary bridge clients.

### Pinned engine images

`FLUX_DOCKER_IMAGES` in `@flux/core` pins **Postgres**, **PostgREST**, and **Traefik** to specific tags (no `:latest`) for reproducible deploys and supply-chain clarity.

### Dashboard API: credentials on demand

- **`ProjectManager.listProjects`** returns only **slug**, **status**, and **apiUrl** (no secrets). It never exposed DB URIs or JWT material; callers must not attach secrets to list responses.
- **`ProjectManager.getProjectCredentials(slug)`** returns **`postgresConnectionString`**, **`anonKey`**, and **`serviceRoleKey`** only when explicitly invoked (e.g. dashboard “Reveal keys”).
- **`GET /api/projects`** returns project metadata and status only — **not** connection strings or API keys.
- **`GET /api/projects/[slug]/credentials`** (authenticated, owner-only) returns sensitive credentials for the Reveal Keys flow.

## Related code

- `@flux/core` — `provisionProject`, `FLUX_DOCKER_IMAGES`, `getProjectCredentials`, `getProjectSummariesForSlugs`, `fluxTenantStatusFromContainerPair`, `listProjects`.
- `apps/dashboard` — `app/api/projects/route.ts`, `app/api/projects/[slug]/credentials/route.ts`, `app/api/projects/[slug]/repair/route.ts`, projects UI.
