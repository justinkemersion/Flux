/**
 * @flux/gateway — public exports
 *
 * Import `createApp` when embedding the gateway in tests or other processes.
 * Use `src/server.ts` as the standalone entry point.
 */

export { createApp } from "./app.ts";
export {
  resolveTenant,
  evictHostname,
  normalizeHost,
  fetchProjectJwtSecret,
} from "./tenant-resolver.ts";
export { tenantIdToShortid } from "./shortid.ts";
export { mintJwt } from "./jwt-issuer.ts";
export { acquireRateSlot } from "./rate-limiter.ts";
export { trackActivity } from "./activity-tracker.ts";
export type { TenantResolution, ProjectMode } from "./types.ts";
export type { CacheSource, ResolvedTenant } from "./tenant-resolver.ts";
