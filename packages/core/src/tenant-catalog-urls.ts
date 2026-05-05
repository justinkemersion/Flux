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
 * Legacy v1 Traefik hostname: `api.<slug>.<hash>.<domain>`.
 * Used for Traefik `Host()` compatibility and gateway cache eviction for pre-flatten URLs.
 */
export function fluxTenantV1LegacyDottedHostname(slug: string, hash: string): string {
  const domain = fluxTenantDomain();
  return `api.${slug}.${hash}.${domain}`;
}

/**
 * @deprecated Use {@link fluxTenantV1LegacyDottedHostname}. The third argument is ignored.
 * Kept for transitional imports; canonical tenant API hostnames are {@link fluxTenantV2SharedHostname}.
 */
export function fluxTenantPostgrestHostname(
  slug: string,
  hash: string,
  _hostnamePrefix = "api",
): string {
  return fluxTenantV1LegacyDottedHostname(slug, hash);
}

/**
 * HTTP(S) origin for a tenant API. Same flattened host as {@link fluxApiUrlForV2Shared}.
 * See {@link fluxApiUrlForV2Shared} for the canonical URL contract.
 *
 * Uses `https://` when `FLUX_DOMAIN` is set, `isProduction`, or a **remote** `DOCKER_HOST` (SSH) —
 * the same case where edge Traefik labels apply. Otherwise `http://` (local `docker` on Unix).
 *
 * @deprecated The fourth argument `hostnamePrefix` is ignored. Canonical shape is always
 *   `https://api--<slug>--<hash>.<domain>`.
 */
export function fluxApiUrlForSlug(
  slug: string,
  hash: string,
  isProduction = false,
  _hostnamePrefix = "api",
): string {
  const useHttps =
    fluxApiHttpsForTenantUrls() || isProduction || fluxControlPlaneTargetIsRemoteEngine();
  const scheme = useHttps ? "https" : "http";
  return `${scheme}://${fluxTenantV2SharedHostname(slug, hash)}`;
}

/** Catalog execution mode: dedicated PostgREST vs pooled gateway + shared cluster. */
export type FluxCatalogProjectMode = "v1_dedicated" | "v2_shared";

/**
 * Hostname for {@link fluxApiUrlForV2Shared} (no scheme): `api--<slug>--<hash>.<domain>`.
 * Same shape for v2_shared and v1_dedicated. Example: `api--acme--abc1234.vsl-base.com`.
 */
export function fluxTenantV2SharedHostname(slug: string, hash: string): string {
  const domain = fluxTenantDomain();
  return `api--${slug}--${hash}.${domain}`;
}

/**
 * Canonical Flux API URL.
 *
 * NOTE:
 * This is the only supported external API hostname format.
 * Do not construct API URLs manually.
 *
 * Full origin (scheme + host) for v2_shared (gateway → PostgREST pool). Same HTTPS selection as
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
 * Returns the catalog API URL for the given mode. Both modes use the same flattened
 * `api--<slug>--<hash>.<domain>` contract; the mode argument is kept for API stability.
 */
export function fluxApiUrlForCatalog(
  slug: string,
  hash: string,
  isProduction: boolean,
  _mode: FluxCatalogProjectMode,
): string {
  return fluxApiUrlForV2Shared(slug, hash, isProduction);
}
