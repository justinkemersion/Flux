/** Engine + host snapshot for control-plane dashboards (`ProjectManager.getNodeStats`). */
export type FluxNodeStats = {
  /** Total local containers on the Engine (from `docker info`). */
  containerCount: number;
  /** RAM use approx. % of host (0–100, one decimal) from `os` freemem/totalmem. */
  memoryUsage: number;
  /** 1-minute load average (Unix); `0` if unavailable. */
  cpuLoad: number;
};

export type ProjectDumpOptions = {
  schemaOnly?: boolean;
  dataOnly?: boolean;
  clean?: boolean;
  publicOnly?: boolean;
};

/** Sensitive tenant credentials — use {@link ProjectManager.getProjectCredentials} only when needed. */
export type FluxProjectCredentials = {
  postgresConnectionString: string;
  anonKey: string;
  serviceRoleKey: string;
};

/** Catalog row from the flux-system `projects` table (control-plane metadata DB). */
export interface FluxSystemProjectActivity {
  id: string;
  name: string;
  slug: string;
  lastAccessedAt: Date;
  /** `true` when {@link FluxSystemProjectActivity.lastAccessedAt} is older than `maxAgeDays` passed to {@link ProjectManager.stopInactiveProjects}. */
  inactiveByPolicy: boolean;
}

/** Describes a fully provisioned Flux tenant: PostgREST on the shared + private networks; DB on the private network only. */
export interface FluxProject {
  /** Display name supplied to `provisionProject`. */
  name: string;
  /** Normalized identifier used in container names (e.g. `my-app` → `flux-{hash}-my-app-db`). */
  slug: string;
  /** Random per-project 7-hex id embedded in Docker names and the public API hostname. */
  hash: string;
  /**
   * Traefik-facing user-defined bridge (e.g. `flux-network`). PostgREST attaches here and to
   * {@link privateNetworkName}. Tenant Postgres is only on the private network; the **`flux-system`**
   * Postgres is also on this bridge so the control plane can open a TCP `pg` `Pool` to the catalog.
   */
  networkName: string;
  /**
   * Isolated **internal** bridge (`flux-{hash}-{slug}-net`) shared by this project’s DB and API only.
   * `PGRST_DB_URI` uses the Postgres container name, which is resolvable on this network.
   */
  privateNetworkName: string;
  postgres: {
    containerId: string;
    /**
     * Docker DNS hostname (same on the private network). Not reachable from arbitrary containers on
     * {@link networkName} because Postgres is not attached there.
     */
    containerName: string;
  };
  postgrest: {
    containerId: string;
    containerName: string;
  };
  /** Public PostgREST base URL via Traefik (no per-tenant host port). */
  apiUrl: string;
  /** Secret PostgREST uses for JWT verification (generated or from {@link ProvisionOptions.customJwtSecret}). */
  jwtSecret: string;
  /** Generated Postgres superuser password — treat as sensitive. */
  postgresPassword: string;
  /**
   * When true, the gateway chains per-tenant CORS + `flux-<hash>-<slug>-stripprefix` for `/rest/v1` (see {@link ProvisionOptions.stripSupabaseRestPrefix}).
   */
  stripSupabaseRestPrefix: boolean;
}

/**
 * Optional hooks for long-running {@link ProjectManager.provisionProject} work (CLIs, logs).
 *
 * **Control-plane env (read during provision, not fields here):**
 * - **`FLUX_DEV_POSTGRES_PASSWORD`** — when non-empty, derives a stable Postgres password from this
 *   secret and the tenant volume name so `POSTGRES_PASSWORD` and `PGRST_DB_URI` always match (dev/test only).
 * - **`FLUX_RESET_TENANT_VOLUME`** — when truthy (`1` / `true` / `yes`), removes the tenant PostgREST +
 *   Postgres containers and the data volume before creating a fresh `PGDATA` (ignored for `flux-system`).
 */
export interface ProvisionOptions {
  onStatus?: (message: string) => void;
  /**
   * When set (e.g. Clerk or NextAuth JWT signing secret), used as `PGRST_JWT_SECRET` for PostgREST
   * so the tenant API can verify tokens minted by your auth provider. If omitted, a random secret is generated.
   */
  customJwtSecret?: string;
  /**
   * When true (default), the tenant router chains per-tenant CORS (dashboard + when `FLUX_DOMAIN` is set
   * `https://<slug>.<FLUX_DOMAIN>` + env extras + HTTPS `*.domain` regex) and `flux-<hash>-<slug>-stripprefix`
   * so the Supabase JS client’s `/rest/v1` path reaches PostgREST.
   * Set to false only if clients call PostgREST at the URL root with no `/rest/v1` prefix.
   */
  stripSupabaseRestPrefix?: boolean;
  /**
   * When true, {@link ProjectManager.provisionProject} returns an `https://` {@link FluxProject.apiUrl}
   * (alongside `https://` when `FLUX_DOMAIN` is set). When false and `FLUX_DOMAIN` is unset, returns
   * `http://` (typical local dev).
   */
  isProduction?: boolean;
  /**
   * Per-project CORS extra allow-origins (e.g. `["https://app.example.com", "http://localhost:3000"]`)
   * unioned on top of the built-in dashboard origins and the global
   * `FLUX_EXTRA_ALLOWED_ORIGINS` env var, and the automatic `https://<slug>.<FLUX_DOMAIN>` origin when
   * `FLUX_DOMAIN` is set. Persisted extras only (not the built-ins) on the PostgREST container via the
   * {@link FLUX_CORS_EXTRA_ORIGINS_LABEL} label so subsequent reconciles preserve them.
   *
   * Pass `[]` (empty array) to **clear** previously persisted per-project extras. Omit to
   * carry the persisted list forward unchanged.
   */
  additionalAllowedOrigins?: readonly string[];
  /**
   * Primary PostgREST schema (`api` or mirrored `t_<shortId>_api`). Defaults to `api`.
   * Forced to `api` for the `flux-system` stack regardless of this option.
   */
  apiSchemaName?: string;
}

/** Required for {@link ProjectManager.nukeProject} — confirms permanent data loss. */
export interface NukeProjectOptions {
  acknowledgeDataLoss: true;
  /** Per-project hash from the flux-system `projects.hash` column for this stack. */
  hash: string;
}

/**
 * Success from {@link ProjectManager.deleteProjectInfrastructure} — Docker API data volume is
 * confirmed absent (404) after the delete attempt.
 */
export type DeleteProjectInfrastructureResult = {
  ok: true;
  removed: {
    apiContainer: string;
    dbContainer: string;
    volume: string;
    privateNetwork: string;
  };
};

/** Catalog slug + per-project hash for Docker lookups (e.g. dashboard session user). */
export type FluxProjectSlugRef = { slug: string; hash: string };
