# Flux production security (architect audit memory)

This document records the **Senior Architect** audit themes and the **implemented** mitigations in-tree. Update it when security posture changes.

## Critical themes (ongoing)

1. **Docker socket** — Traefik uses the Engine API via a mounted socket. Treat socket access as **host-equivalent**; isolate the daemon, restrict operators, consider rootless or remote TLS with strict ACLs.
2. **Control plane trust** — Anyone who can call the dashboard/API with a valid session can provision and manage tenants. Harden Auth.js, rate limits, and deployment network boundaries.
3. **State sync** — Docker state and the `flux-system` catalog can drift (manual `docker rm`, failed inserts). A future **reconcile job** should align DB rows with Engine state.

## Implemented mitigations

### Localhost-only Postgres host port

Tenant Postgres `PortBindings` use **`127.0.0.1`** (not `0.0.0.0`) so the published port is only reachable from the Docker host (e.g. via SSH tunnel or local tools). Inter-container traffic uses **`flux-network`** and container DNS.

### Pinned engine images

`FLUX_DOCKER_IMAGES` in `@flux/core` pins **Postgres**, **PostgREST**, and **Traefik** to specific tags (no `:latest`) for reproducible deploys and supply-chain clarity.

### Dashboard API: credentials on demand

- **`ProjectManager.listProjects`** returns only **slug**, **status**, and **apiUrl** (no secrets). It never exposed DB URIs or JWT material; callers must not attach secrets to list responses.
- **`ProjectManager.getProjectCredentials(slug)`** returns **`postgresConnectionString`**, **`anonKey`**, and **`serviceRoleKey`** only when explicitly invoked (e.g. dashboard “Reveal keys”).
- **`GET /api/projects`** returns project metadata and status only — **not** connection strings or API keys.
- **`GET /api/projects/[slug]/credentials`** (authenticated, owner-only) returns sensitive credentials for the Reveal Keys flow.

## Related code

- `@flux/core` — `provisionProject`, `FLUX_DOCKER_IMAGES`, `getProjectCredentials`, `listProjects`.
- `apps/dashboard` — `app/api/projects/route.ts`, `app/api/projects/[slug]/credentials/route.ts`, projects UI.
