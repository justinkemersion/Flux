import { isPlatformSystemStackSlug } from "./docker-names.ts";

/**
 * Loopback bind for optional `flux-system` host port maps so Postgres / PostgREST are not exposed on
 * all interfaces.
 */
export const FLUX_SYSTEM_HOST_PORT_BIND = "127.0.0.1";

/**
 * Parses `FLUX_SYSTEM_POSTGRES_PUBLISH_PORT` / `FLUX_SYSTEM_POSTGREST_PUBLISH_PORT` when set.
 * Must be a decimal TCP port 1–65535.
 */
export function parseFluxSystemHostPublishPortEnv(
  envName: string,
): string | undefined {
  const raw = process.env[envName]?.trim();
  if (!raw) return undefined;
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(
      `${envName} must be empty or a decimal TCP port number (1–65535).`,
    );
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(
      `${envName} must be empty or a decimal TCP port number (1–65535).`,
    );
  }
  return String(n);
}

/** Host port for `flux-system` Postgres (`127.0.0.1:<port>` → container `5432/tcp`), or unset. */
export function fluxSystemPostgresHostPublishPort(
  slug: string,
): string | undefined {
  if (!isPlatformSystemStackSlug(slug)) return undefined;
  return parseFluxSystemHostPublishPortEnv("FLUX_SYSTEM_POSTGRES_PUBLISH_PORT");
}

/** Host port for `flux-system` PostgREST (`127.0.0.1:<port>` → container `3000/tcp`), or unset. */
export function fluxSystemPostgrestHostPublishPort(
  slug: string,
): string | undefined {
  if (!isPlatformSystemStackSlug(slug)) return undefined;
  return parseFluxSystemHostPublishPortEnv("FLUX_SYSTEM_POSTGREST_PUBLISH_PORT");
}
