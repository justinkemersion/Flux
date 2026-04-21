import { randomBytes } from "node:crypto";

/** Hex length of the per-project `hash` segment embedded in Docker / Traefik resource names. */
export const FLUX_PROJECT_HASH_HEX_LEN = 7;

/**
 * Fixed, well-known hash for the platform `flux-system` stack so its containers / hostnames are
 * always locatable without a DB round-trip. Tenant projects use random per-project hashes (see
 * {@link generateProjectHash}). Must be exactly {@link FLUX_PROJECT_HASH_HEX_LEN} hex chars so it
 * also matches the tenant-container regex used by `listProjects`.
 */
export const FLUX_SYSTEM_HASH = "5y57e70";

/**
 * Generates a random 7-char hex id for a new project. Used as the `hash` segment in
 * `flux-${hash}-${slug}-{db,api}` Docker names, the tenant volume, Traefik middleware names,
 * and the public hostname `api.${slug}.${hash}.${domain}`.
 *
 * Entropy: `crypto.randomBytes(4)` → 8 hex chars, sliced to 7 → 2^28 ≈ 268M ids. Collisions
 * within a single user's namespace are rejected by the `(userId, slug)` unique index in the
 * flux-system `projects` table, so retries are only needed on the extremely rare name clash at
 * the Docker layer.
 */
export function generateProjectHash(): string {
  return randomBytes(4).toString("hex").slice(0, FLUX_PROJECT_HASH_HEX_LEN);
}
