/**
 * Flux gateway public contract version (semver).
 *
 * Downstream doctor/integration tooling (e.g. Flux Foundry) may validate host
 * routing, inbound project JWT requirements, bridge JWT role mapping, and
 * fail-closed anonymous access against this version.
 */
export const FLUX_GATEWAY_CONTRACT_VERSION = "1.0.0";

/** Human-readable invariants for the v1.0.0 gateway contract. */
export const FLUX_GATEWAY_CONTRACT_INVARIANTS = [
  "Inbound Bearer project JWT (HS256, per-project jwt_secret) is required for all tenant API routes except /health and /health/deep.",
  "External JWT role claims are sanitized; bridge JWTs minted for PostgREST use the tenant role t_<12hex>_role.",
  "Protected resources (e.g. /profiles) return 401 without valid inbound auth — no anonymous PostgREST access.",
  "Accept-Profile and Content-Profile are injected for the resolved tenant API schema.",
] as const;
