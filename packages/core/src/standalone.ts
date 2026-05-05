/**
 * Dependency-light entry for clients (e.g. standalone CLI) that must not import Dockerode
 * or the full `ProjectManager` control plane in `index.ts`.
 */

export { FLUX_PROJECT_HASH_HEX_LEN } from "./tenant-suffix.ts";

export type ImportSqlFileResult = {
  tablesMoved: number;
  sequencesMoved: number;
  viewsMoved: number;
};

/** One row for project env list operations. */
export type FluxProjectEnvEntry =
  | { key: string; sensitive: true }
  | { key: string; value: string; sensitive: false };

/** Docker resource names for a tenant stack (matches control-plane naming in `@flux/core`). */
export function fluxTenantDockerResourceNames(
  nameOrSlug: string,
  hash: string,
): {
  api: string;
  db: string;
  volume: string;
  network: string;
} {
  const slug = slugifyProjectName(nameOrSlug);
  const base = `flux-${hash}-${slug}`;
  return {
    api: `${base}-api`,
    db: `${base}-db`,
    volume: `${base}-db-data`,
    network: `${base}-net`,
  };
}

export function slugifyProjectName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) {
    throw new Error(
      `Invalid project name "${name}": use letters, numbers, or separators`,
    );
  }
  return slug;
}

/**
 * Deterministic tenant identifier used for v2 shared-cluster schema/role names.
 *
 * Algorithm: remove UUID hyphens, lower-case, then take the first 12 hex chars.
 */
export function deriveShortId(tenantId: string): string {
  return tenantId.replace(/-/g, "").slice(0, 12).toLowerCase();
}

/**
 * Multi-line `.env` fragment for app ↔ Flux gateway wiring (browser + server URLs + JWT placeholder).
 * Kept in sync with the dashboard connection manifest (`APP .ENV`); comments are intentional.
 */
export function buildFluxAppDotEnvSnippet(apiUrl: string): string {
  return `# Public URL for browser/client calls
NEXT_PUBLIC_FLUX_URL=${apiUrl}

# Server-only URL for routes/actions
FLUX_URL=${apiUrl}

# Shared JWT secret used to verify tokens at Flux gateway
# Use your Auth.js / Clerk signing secret, generated once
# Example: openssl rand -base64 48
FLUX_GATEWAY_JWT_SECRET=`;
}

/** Row returned for project list / summaries. */
export interface FluxProjectSummary {
  /** Normalized project slug (from container names). */
  slug: string;
  /** Per-project hash segment (7 hex) in Docker names and public API host (`api--…` pooled, `api.…` dedicated). */
  hash: string;
  /**
   * Combined health of Postgres + PostgREST containers.
   * **missing** — neither container exists (e.g. catalog row without Docker).
   * **corrupted** — exactly one of the two containers exists.
   */
  status: "running" | "stopped" | "partial" | "missing" | "corrupted";
  /** Public API URL (`https://api--{slug}--{hash}.…` for v2_shared, `https://api.{slug}.{hash}.…` for v1). */
  apiUrl: string;
}

type ContainerLifecycleState = "running" | "stopped" | "missing";

/**
 * Maps Postgres + PostgREST container states to a single tenant status (shared by
 * list and summary helpers in the full control plane).
 */
export function fluxTenantStatusFromContainerPair(
  db: ContainerLifecycleState,
  api: ContainerLifecycleState,
): FluxProjectSummary["status"] {
  const hasDb = db !== "missing";
  const hasApi = api !== "missing";
  if (!hasDb && !hasApi) return "missing";
  if (hasDb !== hasApi) return "corrupted";
  if (db === "running" && api === "running") return "running";
  if (db === "stopped" && api === "stopped") return "stopped";
  return "partial";
}

export {
  FLUX_DEFAULT_DOMAIN,
  fluxApiHttpsForTenantUrls,
  fluxApiUrlForCatalog,
  fluxApiUrlForSlug,
  fluxTenantDomain,
  fluxTenantPostgrestHostname,
  fluxTenantV1LegacyDottedHostname,
  fluxTenantV2SharedHostname,
  fluxApiUrlForV2Shared,
  type FluxCatalogProjectMode,
} from "./tenant-catalog-urls.ts";
