import { createHash } from "node:crypto";

/** MD5 hex slice length used in Docker / Traefik resource names and hostnames. */
export const FLUX_TENANT_SUFFIX_HEX_LEN = 7;

/**
 * Stable owner-scoped id for Docker container names, Traefik router/middleware/service names,
 * and the DNS label under `api.{slug}.{suffix}.{domain}`.
 *
 * @param clerkUserId — Stable opaque user id (e.g. Clerk `sub`, Auth.js `users.id`).
 */
export function getTenantSuffix(clerkUserId: string): string {
  return createHash("md5")
    .update(clerkUserId, "utf8")
    .digest("hex")
    .slice(0, FLUX_TENANT_SUFFIX_HEX_LEN);
}

/** Synthetic owner key for the platform `flux-system` Postgres stack (deterministic suffix). */
export const FLUX_SYSTEM_OWNER_KEY = "__flux_system__";

/** Default owner key when no user / `FLUX_OWNER_KEY` is provided (single-operator CLI). */
export const FLUX_DEFAULT_OWNER_KEY = "__flux_default_owner__";

/**
 * Resolves the owner key used for tenant-scoped Docker and Traefik naming.
 * Precedence: explicit `ownerKey` → `FLUX_OWNER_KEY` env → {@link FLUX_DEFAULT_OWNER_KEY}.
 */
export function resolveProvisionOwnerKey(ownerKey?: string): string {
  const o = ownerKey?.trim();
  if (o) return o;
  const e = process.env.FLUX_OWNER_KEY?.trim();
  if (e) return e;
  return FLUX_DEFAULT_OWNER_KEY;
}
