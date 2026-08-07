/**
 * Cross-package v2 tenant API contracts (gateway, dashboard probes, external app doctors).
 * Keep error strings aligned with `@flux/gateway` inbound auth and Foundry doctor expectations.
 */

/** HTTP status when the v2 gateway resolved the tenant but no valid project Bearer was sent. */
export const V2_GATEWAY_AUTH_REQUIRED_STATUS = 401 as const;

/** JSON `{ error }` body field for {@link V2_GATEWAY_AUTH_REQUIRED_STATUS}. */
export const V2_GATEWAY_AUTH_REQUIRED_ERROR = "authorization required" as const;

/** Bridge JWT downstream `role` claim for verified project JWTs (never forwards `authenticated`). */
export type V2BridgeJwtRoleClaim = `t_${string}_role`;
