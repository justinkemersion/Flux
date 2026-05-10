import {
  FLUX_MANAGED_LABEL,
  FLUX_MANAGED_VALUE,
  FLUX_NETWORK_NAME,
  FLUX_PROJECT_SLUG_LABEL,
  FLUX_PURPOSE_CONTROL_PLANE,
  FLUX_PURPOSE_LABEL,
  FLUX_PURPOSE_TENANT,
  FLUX_TRAEFIK_ACME_RESOLVER,
  LEGACY_UMBRELLA_DOCKER_LABEL_KEYS,
} from "../docker/docker-constants.ts";
import {
  fluxTenantStackBaseId,
  isPlatformSystemStackSlug,
} from "../docker/docker-names.ts";
import {
  fluxApiHttpsForTenantUrls,
  fluxTenantDomain,
  fluxTenantV1LegacyDottedHostname,
  fluxTenantV2SharedHostname,
} from "../tenant-catalog-urls.ts";

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
 * When **non-`null`**, PostgREST gets Traefik labels for `websecure` + myresolver. **Non-`null`** for
 * `FLUX_TRAEFIK_CERTRESOLVER`, `FLUX_DOMAIN`, or remote `DOCKER_HOST` (typical: `ssh://` from the
 * `flux` CLI on a dev machine). **Null** for local `docker` (no `DOCKER_HOST` / `unix` socket). Use
 * `FLUX_TRAEFIK_NO_EDGE=1` to turn off over SSH. Labels use {@link FLUX_TRAEFIK_ACME_RESOLVER}.
 */
export function fluxTraefikCertResolverName(): string | null {
  const r = process.env.FLUX_TRAEFIK_CERTRESOLVER?.trim();
  if (r) return r;
  if (fluxApiHttpsForTenantUrls()) return FLUX_TRAEFIK_ACME_RESOLVER;
  if (fluxControlPlaneTargetIsRemoteEngine()) return FLUX_TRAEFIK_ACME_RESOLVER;
  return null;
}

/**
 * Traefik v3 `Host()` matcher: backticks wrap literal hostnames (required syntax).
 * Canonical flattened host OR legacy dotted v1 host so existing clients keep working.
 * Example: `Host(\`api--acme--abc1234.example.com\`) || Host(\`api.acme.abc1234.example.com\`)`.
 */
function traefikHostRule(slug: string, hash: string): string {
  const flat = fluxTenantV2SharedHostname(slug, hash);
  const dotted = fluxTenantV1LegacyDottedHostname(slug, hash);
  return `Host(\`${flat}\`) || Host(\`${dotted}\`)`;
}

/**
 * Built-in CORS allow-list: Flux dashboard (`http://localhost:3001` for dev,
 * `https://app.<FLUX_DOMAIN|vsl-base.com>` for prod). When `FLUX_DOMAIN` is set,
 * each tenant’s production app UI at `https://<slug>.<FLUX_DOMAIN>` is also allowed.
 * Tenant apps add more origins via {@link FLUX_CORS_EXTRA_ORIGINS_LABEL} or the global
 * {@link FLUX_EXTRA_ALLOWED_ORIGINS_ENV} env var (see {@link resolveCorsAllowOriginList}).
 */
function traefikDashboardOrigins(): readonly string[] {
  return ["http://localhost:3001", `https://app.${fluxTenantDomain()}`];
}

/**
 * Per-tenant Docker label that persists the extra CORS allow-origins list across container
 * recreates. Comma-separated, trimmed origins. Empty / missing means "no extras".
 */
export const FLUX_CORS_EXTRA_ORIGINS_LABEL = "flux.cors.extra_origins";

/**
 * Control-plane env var: comma-separated origins applied as extras to **every** tenant's
 * CORS allow-list. Useful when you operate the whole fleet (e.g. `https://app.example.com`,
 * `http://localhost:3000`) and want one place to allow them. Per-project label is unioned on top.
 */
const FLUX_EXTRA_ALLOWED_ORIGINS_ENV = "FLUX_EXTRA_ALLOWED_ORIGINS";

/**
 * Splits a comma-separated origin list into a deduped, trimmed array. Drops empty entries; does
 * **not** validate URL shape (Traefik tolerates `http://localhost:3001` and `https://a.example`).
 */
export function parseAllowedOriginsList(
  raw: string | null | undefined,
): readonly string[] {
  if (raw == null) return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed.length > 0) seen.add(trimmed);
  }
  return Array.from(seen);
}

/** Inverse of {@link parseAllowedOriginsList}. Stable order = first-seen. */
export function serializeAllowedOriginsList(
  origins: readonly string[],
): string {
  return Array.from(new Set(origins.map((o) => o.trim()).filter(Boolean))).join(
    ",",
  );
}

/**
 * Resolves the full CORS `Access-Control-Allow-Origin` allow-list for a tenant's PostgREST router:
 * built-in dashboard origins ∪ (when `FLUX_DOMAIN` is set) `https://<slug>.<FLUX_DOMAIN>` ∪
 * control-plane {@link FLUX_EXTRA_ALLOWED_ORIGINS_ENV} ∪ per-project extras (from the
 * {@link FLUX_CORS_EXTRA_ORIGINS_LABEL} label or an explicit override). Order follows insertion
 * (dashboard first), deduped.
 */
function resolveCorsAllowOriginList(
  perProjectExtras: readonly string[],
  slug: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (origin: string) => {
    const trimmed = origin.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };
  for (const o of traefikDashboardOrigins()) push(o);
  if (fluxApiHttpsForTenantUrls()) {
    push(`https://${slug}.${fluxTenantDomain()}`);
  }
  for (const o of parseAllowedOriginsList(
    process.env[FLUX_EXTRA_ALLOWED_ORIGINS_ENV],
  )) {
    push(o);
  }
  for (const o of perProjectExtras) push(o);
  return out;
}

/**
 * Per-project Traefik middleware names scoped by random project hash + slug so multiple users on
 * one Traefik instance never collide (Traefik v3 treats middleware names as a global namespace).
 */
function traefikCorsMiddlewareName(hash: string, slug: string): string {
  return `${fluxTenantStackBaseId(hash, slug)}-cors`;
}

function traefikStripMiddlewareName(hash: string, slug: string): string {
  return `${fluxTenantStackBaseId(hash, slug)}-stripprefix`;
}

/** HTTPS origins for deployed apps under {@link fluxTenantDomain} (e.g. YeastCoast at `https://slug.domain`). */
function fleetHttpsOriginsRegex(domain: string): string {
  const escaped = domain.replace(/\\/g, "\\\\").replace(/\./g, "\\.");
  return `^https://.+\\.${escaped}$`;
}

/** Supabase JS + PostgREST (explicit list; no wildcard). */
const TRAEFIK_CORS_ALLOW_HEADERS =
  "apikey,Authorization,Content-Type,X-Client-Info,Accept-Profile,Content-Profile,Prefer,Accept,Range";

/** Purpose + slug metadata for Flux-managed DB/API containers (see {@link FLUX_MANAGED_LABEL}). */
export function fluxContainerMetadataLabels(slug: string): Record<string, string> {
  const out: Record<string, string> = {
    [FLUX_MANAGED_LABEL]: FLUX_MANAGED_VALUE,
  };
  if (isPlatformSystemStackSlug(slug)) {
    out[FLUX_PURPOSE_LABEL] = FLUX_PURPOSE_CONTROL_PLANE;
  } else {
    out[FLUX_PURPOSE_LABEL] = FLUX_PURPOSE_TENANT;
    out[FLUX_PROJECT_SLUG_LABEL] = slug;
  }
  return out;
}

export function stripLegacyUmbrellaMetadataFromLabels(
  labels: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(labels)) {
    if (LEGACY_UMBRELLA_DOCKER_LABEL_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Traefik labels for the tenant PostgREST router (shared by provision and label updates).
 *
 * **Naming rule (global-hash namespacing — keep absolutely consistent with the hostname):**
 *   - Router / service id   `flux-${hash}-${slug}-api`
 *   - CORS middleware id    `flux-${hash}-${slug}-cors`
 *   - Strip middleware id   `flux-${hash}-${slug}-stripprefix`
 *   - Router rule           flattened `api--…` **or** legacy dotted `api.…` (see {@link traefikHostRule})
 *
 * All four share the same `flux-${hash}-${slug}` base ({@link fluxTenantStackBaseId}) and the
 * hostnames from {@link fluxTenantV2SharedHostname} and {@link fluxTenantV1LegacyDottedHostname}
 * so Traefik can never mismatch a router’s `.rule` with its `.service`.
 *
 * `perProjectExtraOrigins` is layered on top of the built-in dashboard origins and
 * {@link FLUX_EXTRA_ALLOWED_ORIGINS_ENV}; the resolved list is stamped both into the Traefik
 * `accesscontrolalloworiginlist` middleware **and** the {@link FLUX_CORS_EXTRA_ORIGINS_LABEL}
 * label so the next reconcile/recreate can read it back without callers re-passing it.
 */
export function postgrestTraefikDockerLabels(
  slug: string,
  hash: string,
  stripSupabaseRestPrefix: boolean,
  perProjectExtraOrigins: readonly string[] = [],
): Record<string, string> {
  const traefikSvc = `${fluxTenantStackBaseId(hash, slug)}-api`;
  const corsMw = traefikCorsMiddlewareName(hash, slug);
  const stripMw = traefikStripMiddlewareName(hash, slug);
  const useEdgeTls = fluxTraefikCertResolverName() != null;
  const labels: Record<string, string> = {
    "traefik.enable": "true",
    "traefik.docker.network": FLUX_NETWORK_NAME,
    [`traefik.http.routers.${traefikSvc}.rule`]: traefikHostRule(slug, hash),
    [`traefik.http.routers.${traefikSvc}.entrypoints`]: useEdgeTls
      ? "websecure"
      : "web",
    [`traefik.http.routers.${traefikSvc}.service`]: traefikSvc,
    [`traefik.http.services.${traefikSvc}.loadbalancer.server.port`]: "3000",
    // Beat low-priority edge catch-alls (e.g. static nginx on `*.domain`) regardless of rule-length defaults.
    [`traefik.http.routers.${traefikSvc}.priority`]: "100",
  };
  if (useEdgeTls) {
    // Router only on `websecure` with explicit ACME resolver — avoids Traefik "default" cert.
    labels[`traefik.http.routers.${traefikSvc}.tls`] = "true";
    labels[`traefik.http.routers.${traefikSvc}.tls.certresolver`] =
      FLUX_TRAEFIK_ACME_RESOLVER;
  }

  labels[`traefik.http.middlewares.${stripMw}.stripprefix.prefixes`] = "/rest/v1";

  const allowOriginList = resolveCorsAllowOriginList(perProjectExtraOrigins, slug);
  labels[`traefik.http.middlewares.${corsMw}.headers.accesscontrolalloworiginlist`] =
    allowOriginList.join(",");
  labels[`traefik.http.middlewares.${corsMw}.headers.accesscontrolalloworiginlistregex`] =
    fleetHttpsOriginsRegex(fluxTenantDomain());
  labels[`traefik.http.middlewares.${corsMw}.headers.accesscontrolallowmethods`] =
    "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD";
  labels[`traefik.http.middlewares.${corsMw}.headers.accesscontrolallowheaders`] =
    TRAEFIK_CORS_ALLOW_HEADERS;
  labels[`traefik.http.middlewares.${corsMw}.headers.accesscontrolmaxage`] = "86400";
  labels[`traefik.http.middlewares.${corsMw}.headers.addvaryheader`] = "true";

  // Persist the per-project extras (NOT the dashboard / env-var origins — those are recomputed
  // on every label rebuild). Empty string when no extras so the label is still present and
  // contributes to the config hash deterministically.
  labels[FLUX_CORS_EXTRA_ORIGINS_LABEL] =
    serializeAllowedOriginsList(perProjectExtraOrigins);

  const middlewares = stripSupabaseRestPrefix
    ? `${corsMw},${stripMw}`
    : corsMw;
  labels[`traefik.http.routers.${traefikSvc}.middlewares`] = middlewares;

  return { ...labels, ...fluxContainerMetadataLabels(slug) };
}

/**
 * Strips **all** Traefik labels off a tenant container so the router/service/middleware set can
 * be re-stamped cleanly. Preserves non-Traefik labels and the persisted
 * {@link FLUX_CORS_EXTRA_ORIGINS_LABEL} (read back by {@link mergedPostgrestTraefikDockerLabels}).
 *
 * Intentionally **not** scoped to the current `flux-${hash}-${slug}-*` namespace: legacy Flux
 * installations stamped router/middleware names without the project hash segment (e.g.
 * `flux-${slug}-api`, `flux-${slug}-cors`, `flux-${slug}-stripprefix`). Leaving any of those
 * behind collides with the new hashed namespace under Traefik v3 (which treats router, service,
 * and middleware names as global) and is a known cause of `404 Service Not Found` after a
 * migration — both the old and new definitions race, and the legacy ones keep pointing at a
 * hostname/port that no longer exists. Wiping the entire `traefik.*` surface is the only safe,
 * idempotent answer for a catalog that mixes pre- and post-hash containers.
 */
export function stripAllTraefikLabelsPreservingFluxExtras(
  existing: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(existing)) {
    if (k === FLUX_CORS_EXTRA_ORIGINS_LABEL) {
      out[k] = v;
      continue;
    }
    if (k === "traefik.enable") continue;
    if (k === "traefik.docker.network") continue;
    if (k.startsWith("traefik.")) continue;
    if (LEGACY_UMBRELLA_DOCKER_LABEL_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Rebuilds the tenant PostgREST router labels, preserving the **per-project** CORS extras across
 * recreates by reading them back from the {@link FLUX_CORS_EXTRA_ORIGINS_LABEL} on the existing
 * container. Pass `extraOriginsOverride` (e.g. from the `flux cors` CLI) to **replace** the
 * persisted list with the new one; omit it to carry the existing list forward unchanged.
 */
export function mergedPostgrestTraefikDockerLabels(
  existing: Record<string, string>,
  slug: string,
  hash: string,
  stripSupabaseRestPrefix: boolean,
  extraOriginsOverride?: readonly string[],
): Record<string, string> {
  const extras =
    extraOriginsOverride ??
    parseAllowedOriginsList(existing[FLUX_CORS_EXTRA_ORIGINS_LABEL]);
  return {
    ...stripAllTraefikLabelsPreservingFluxExtras(existing),
    ...postgrestTraefikDockerLabels(
      slug,
      hash,
      stripSupabaseRestPrefix,
      extras,
    ),
  };
}

/**
 * Dev/ops aid: emits the generated Traefik label set so an operator can eyeball the router,
 * service, middleware, and host rule we just stamped on a tenant PostgREST container. Helpful
 * when diagnosing `404 Service Not Found` after a hash migration — the labels that Traefik
 * actually sees live on the container, and this is the only place we have them assembled.
 */
export function logTraefikLabelsForTenant(
  stage: string,
  slug: string,
  hash: string,
  labels: Record<string, string>,
  onStatus?: (message: string) => void,
): void {
  const sink = onStatus ?? ((m: string) => {
    console.log(m);
  });
  const header = `[flux] Traefik labels (${stage}) for ${fluxTenantStackBaseId(hash, slug)} → ${fluxTenantV2SharedHostname(slug, hash)} (legacy: ${fluxTenantV1LegacyDottedHostname(slug, hash)})`;
  sink(header);
  const keys = Object.keys(labels).sort((a, b) => a.localeCompare(b));
  for (const k of keys) {
    sink(`    ${k} = ${labels[k] ?? ""}`);
  }
}

export function dockerLabelsSatisfy(
  required: Record<string, string>,
  current: Record<string, string> | undefined,
): boolean {
  for (const [k, v] of Object.entries(required)) {
    if (current?.[k] !== v) return false;
  }
  return true;
}

/**
 * Stricter than {@link dockerLabelsSatisfy}: also fails if `current` has any `traefik.*` label
 * that is **not** in `required`. Prevents legacy (pre-hash) router / middleware labels from
 * silently surviving a reconcile pass because the new label set happens to be a strict subset
 * of whatever was on the container before the hash-namespacing refactor landed.
 */
export function traefikLabelsExactlyMatch(
  required: Record<string, string>,
  current: Record<string, string> | undefined,
): boolean {
  if (!dockerLabelsSatisfy(required, current)) return false;
  if (!current) return true;
  for (const k of Object.keys(current)) {
    if (!k.startsWith("traefik.")) continue;
    if (!(k in required)) return false;
  }
  return true;
}
