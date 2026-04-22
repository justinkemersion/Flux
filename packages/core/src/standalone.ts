/**
 * Dependency-light entry for clients (e.g. standalone CLI) that must not import Dockerode
 * or the full `ProjectManager` control plane in `index.ts`.
 */

export type ImportSqlFileResult = {
  tablesMoved: number;
  sequencesMoved: number;
  viewsMoved: number;
};

/** One row for project env list operations. */
export type FluxProjectEnvEntry =
  | { key: string; sensitive: true }
  | { key: string; value: string; sensitive: false };

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

/** Row returned for project list / summaries. */
export interface FluxProjectSummary {
  /** Normalized project slug (from container names). */
  slug: string;
  /** Per-project hash segment in Docker/Traefik names and hostname (`api.{slug}.{hash}.…`). */
  hash: string;
  /**
   * Combined health of Postgres + PostgREST containers.
   * **missing** — neither container exists (e.g. catalog row without Docker).
   * **corrupted** — exactly one of the two containers exists.
   */
  status: "running" | "stopped" | "partial" | "missing" | "corrupted";
  /** Public API URL via the Flux Traefik gateway (`Host: api.{slug}.{suffix}.<FLUX_DOMAIN>`). */
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
