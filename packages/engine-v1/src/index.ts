/**
 * @flux/engine-v1 — Dedicated-container execution strategy.
 *
 * Execution profile: v1_dedicated
 *   One Postgres container + one PostgREST container per project.
 *   Isolated Docker bridge network per tenant.
 *   Traefik routing via dynamic Docker labels.
 *
 * Current state: placeholder package.
 *
 * Phase 2 (tracked separately):
 *   The ProjectManager and dockerode orchestration in @flux/core will migrate here
 *   once the engine interface in @flux/core is stabilised. Until then, @flux/core
 *   is the canonical home for v1_dedicated logic; this package is the future boundary.
 *
 * See docs/pages/architecture/flux-v2-architecture.md — §6 (Internal architecture, engine
 * abstraction) and Reference → Repository layout.
 */

export type EngineV1Placeholder = never;
