# @flux/engine-v1

**Execution profile:** `v1_dedicated`

Dedicated container execution strategy for Flux: one PostgreSQL container and one PostgREST
container per project, isolated Docker bridge network, Traefik routing via dynamic labels.

## Current status

**Placeholder package.** The v1 engine logic currently lives in `@flux/core` (`ProjectManager`,
dockerode orchestration, Traefik label helpers). This package is the future home of that code
once the shared engine interface in `@flux/core` is stabilised (Phase 2).

Do not import from this package until Phase 2 extraction is complete.

## Architecture reference

See [`docs/pages/architecture/flux-v2-architecture.md`](../../docs/pages/architecture/flux-v2-architecture.md):

- §6 — Internal architecture (engine abstraction, shared interface, v1/v2 coexistence)
- Reference → Repository layout (monorepo map)
- §6 — Engine selection by tier (when v1 dedicated is the right mode)
