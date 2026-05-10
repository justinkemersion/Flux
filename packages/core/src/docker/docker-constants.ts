/**
 * Docker labels: Flux-managed Postgres / PostgREST (filter from Traefik, dashboard, etc.).
 * Third-party namespaced keys from a historical engine are stripped on label reconcile; new
 * containers use the `flux.*` namespace.
 */
export const FLUX_NETWORK_NAME = "flux-network";

export const FLUX_MANAGED_LABEL = "flux.managed" as const;
export const FLUX_MANAGED_VALUE = "true" as const;
export const FLUX_PURPOSE_LABEL = "flux.purpose" as const;
export const FLUX_PROJECT_SLUG_LABEL = "flux.project.slug" as const;
export const FLUX_PURPOSE_TENANT = "tenant" as const;
export const FLUX_PURPOSE_CONTROL_PLANE = "control-plane" as const;

/** String literals for historical engine labels; must match what appears on live containers. */
export const LEGACY_UMBRELLA_DOCKER_LABEL_KEYS: ReadonlySet<string> = new Set([
  "vessel.managed",
  "vessel.purpose",
  "vessel.project.slug",
  "vessel.flux.managed",
]);

/**
 * Traefik gateway container (Docker provider: `web` on :80; optional `websecure` on :443 with ACME).
 * Set `FLUX_TRAEFIK_CERTRESOLVER` (or `FLUX_DOMAIN` / remote `DOCKER_HOST`) on the control plane
 * to match this Traefik’s ACME resolver; tenant PostgREST routers use `websecure` + that resolver.
 */
export const FLUX_GATEWAY_CONTAINER_NAME = "flux-gateway";

/**
 * Pinned images for Flux project stacks (Postgres + PostgREST + Traefik).
 *
 * Postgres is the Debian-based official image (NOT `-alpine`).  The Alpine
 * variant uses musl, ships no `locale` binary, and only the baked-in C /
 * POSIX / `en_US.utf8` collations work — Postgres logs `WARNING: no usable
 * system locales were found` on every start and silently fails to sort
 * non-English text correctly.  Debian carries glibc + ICU, costs ~200 MB
 * extra image size, and is data-dir-compatible with prior Alpine deployments
 * at the same major version (no dump/restore required when redeploying).
 */
export const FLUX_DOCKER_IMAGES = {
  postgres: "postgres:16.2",
  postgrest: "postgrest/postgrest:v12.0.2",
  traefik: "traefik:v3.6.7",
} as const;

export const POSTGRES_IMAGE = FLUX_DOCKER_IMAGES.postgres;
export const POSTGREST_IMAGE = FLUX_DOCKER_IMAGES.postgrest;

/** Default superuser when only `POSTGRES_PASSWORD` is set on official images. */
export const POSTGRES_USER = "postgres";

/**
 * Default Traefik ACME `certificatesresolvers.<name>`; must match the edge gateway compose
 * (e.g. `docker/traefik/docker-compose.yml` uses `myresolver`). Overridden by `FLUX_TRAEFIK_CERTRESOLVER`, or
 * set implicitly when `FLUX_DOMAIN` enables HTTPS edge routing.
 */
export const FLUX_TRAEFIK_ACME_RESOLVER = "myresolver" as const;
