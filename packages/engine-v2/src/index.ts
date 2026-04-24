/**
 * @flux/engine-v2 — Shared-cluster execution strategy.
 *
 * Execution profile: v2_shared
 *   Shared PostgreSQL cluster; one schema per tenant (t_<shortid>_api).
 *   One role per tenant (t_<shortid>_role) with CONNECTION LIMIT + statement_timeout.
 *   Pooled PostgREST (2–4 instances); PgBouncer in transaction mode.
 *   Gateway issues all runtime JWTs; PostgREST is never publicly reachable.
 *
 * Naming convention:
 *   shortid  = first 12 hex chars of tenant_id UUID (hyphens removed)
 *   schema   = t_<shortid>_api
 *   role     = t_<shortid>_role
 *
 * v2-only engine operations (to be implemented here):
 *   createTenantSchema(tenantId)       — CREATE SCHEMA t_<shortid>_api
 *   createTenantRole(tenantId)         — CREATE ROLE with limits
 *   assignTenantMetadata(tenantId)     — Write shortid + cluster ref to flux-system
 *
 * Shared engine interface (implemented across v1 + v2):
 *   provisionProject, deleteProject, suspendProject,
 *   getApiUrl, getCredentials, setEnv, listEnv, importSql
 *
 * See docs/flux-v2-architecture.md — §9 (Engine abstraction), §10 (Naming), §14 (DB guardrails).
 */

export type EngineV2Placeholder = never;
