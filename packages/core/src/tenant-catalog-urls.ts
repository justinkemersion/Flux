/**
 * Tenant API hostname / catalog URL helpers with **no** Docker or gRPC dependencies.
 * Safe to import from browser bundles (e.g. `@flux/core/standalone`).
 */

/** Default public parent domain for tenant hostnames (`{slug}.<domain>`). Override with `FLUX_DOMAIN`. */
export const FLUX_DEFAULT_DOMAIN = "vsl-base.com";

/**
 * Parent domain for tenant API hostnames: `FLUX_DOMAIN` when set, otherwise {@link FLUX_DEFAULT_DOMAIN}.
 */
export function fluxTenantDomain(): string {
  const d = process.env.FLUX_DOMAIN?.trim();
  return d && d.length > 0 ? d : FLUX_DEFAULT_DOMAIN;
}

/**
 * When `FLUX_DOMAIN` is set (non-empty), public tenant API URLs use `https://` (TLS at the edge).
 * {@link fluxApiUrlForSlug} also treats the optional `isProduction` flag as a request for `https://`.
 */
export function fluxApiHttpsForTenantUrls(): boolean {
  const d = process.env.FLUX_DOMAIN?.trim();
  return Boolean(d);
}

/**
 * `true` if `DOCKER_HOST` targets a non-default Engine (SSH, remote `tcp`/`https`). Enables edge
 * PostgREST labels on the **remote** host. `FLUX_TRAEFIK_NO_EDGE=1` keeps `web`-only over SSH.
 */
function fluxControlPlaneTargetIsRemoteEngine(): boolean {
  const o = process.env.FLUX_TRAEFIK_NO_EDGE?.trim().toLowerCase();
  if (o === "1" || o === "true" || o === "yes") {
    return false;
  }
  const dh = (process.env.DOCKER_HOST ?? "").trim();
  if (dh.length === 0) {
    return false;
  }
  const l = dh.toLowerCase();
  if (l.startsWith("unix://") || l === "unix:") {
    return false;
  }
  if (l.startsWith("npipe://") || dh.includes("\\\\.\\pipe\\")) {
    return false;
  }
  if (l.startsWith("ssh://")) {
    return true;
  }
  if (l.startsWith("http://") || l.startsWith("https://")) {
    return true;
  }
  if (l.startsWith("tcp://")) {
    if (
      /\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])[:/]/i.test(dh) ||
      /:\/\/localhost[:\/]/i.test(dh)
    ) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * Hostname for tenant PostgREST (Traefik `Host()`), e.g. `api.acme.abc1234.example.com`.
 * Omit or pass an empty `hostnamePrefix` for legacy `{slug}.{domain}` only (no hash segment).
 */
export function fluxTenantPostgrestHostname(
  slug: string,
  hash: string,
  hostnamePrefix = "api",
): string {
  const domain = fluxTenantDomain();
  if (!hostnamePrefix || hostnamePrefix.length === 0) {
    return `${slug}.${domain}`;
  }
  return `${hostnamePrefix}.${slug}.${hash}.${domain}`;
}

/**
 * HTTP(S) origin for a tenant API as routed by Traefik.
 * Uses `https://` when `FLUX_DOMAIN` is set, `isProduction`, or a **remote** `DOCKER_HOST` (SSH) —
 * the same case where edge Traefik labels apply. Otherwise `http://` (local `docker` on Unix).
 */
export function fluxApiUrlForSlug(
  slug: string,
  hash: string,
  isProduction = false,
  hostnamePrefix = "api",
): string {
  const useHttps =
    fluxApiHttpsForTenantUrls() || isProduction || fluxControlPlaneTargetIsRemoteEngine();
  const scheme = useHttps ? "https" : "http";
  return `${scheme}://${fluxTenantPostgrestHostname(slug, hash, hostnamePrefix)}`;
}

/** Catalog execution mode: dedicated PostgREST vs pooled gateway + shared cluster. */
export type FluxCatalogProjectMode = "v1_dedicated" | "v2_shared";

/**
 * Hostname for v2_shared tenants at the edge (single DNS label, SSL-friendly routing).
 * Example: `api--acme--abc1234.vsl-base.com`.
 */
export function fluxTenantV2SharedHostname(slug: string, hash: string): string {
  const domain = fluxTenantDomain();
  return `api--${slug}--${hash}.${domain}`;
}

/**
 * Public API URL for v2_shared (gateway → PostgREST pool). Same HTTPS selection as
 * {@link fluxApiUrlForSlug}.
 */
export function fluxApiUrlForV2Shared(
  slug: string,
  hash: string,
  isProduction = false,
): string {
  const useHttps =
    fluxApiHttpsForTenantUrls() || isProduction || fluxControlPlaneTargetIsRemoteEngine();
  const scheme = useHttps ? "https" : "http";
  return `${scheme}://${fluxTenantV2SharedHostname(slug, hash)}`;
}

/**
 * Returns the catalog API URL for the given mode: flat `api--` host for `v2_shared`,
 * dot-separated {@link fluxApiUrlForSlug} for `v1_dedicated`.
 */
export function fluxApiUrlForCatalog(
  slug: string,
  hash: string,
  isProduction: boolean,
  mode: FluxCatalogProjectMode,
): string {
  return mode === "v2_shared"
    ? fluxApiUrlForV2Shared(slug, hash, isProduction)
    : fluxApiUrlForSlug(slug, hash, isProduction);
}
