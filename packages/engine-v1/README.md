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

See [`docs/flux-v2-architecture.md`](../../docs/flux-v2-architecture.md):

- §9 — Engine abstraction (shared interface + v1-only methods)
- §21 — Monorepo map
- §3 — v1 vs v2 comparison
