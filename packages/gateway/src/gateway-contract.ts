/**
 * Flux gateway public contract version (semver).
 *
 * Canonical definition lives in `@flux/core/contract-versions` so the control plane can
 * advertise it and the CLI can assert it without depending on `@flux/gateway`. Re-exported
 * here to keep this module the gateway's public contract surface.
 */
export { FLUX_GATEWAY_CONTRACT_VERSION } from "@flux/core/contract-versions";

/** Human-readable invariants for the v1.0.0 gateway contract. */
export const FLUX_GATEWAY_CONTRACT_INVARIANTS = [
  "Inbound Bearer project JWT (HS256, per-project jwt_secret) is required for all tenant API routes except /health and /health/deep.",
  "External JWT role claims are sanitized; bridge JWTs minted for PostgREST use the tenant role t_<12hex>_role.",
  "Protected resources (e.g. /profiles) return 401 without valid inbound auth — no anonymous PostgREST access.",
  "Accept-Profile and Content-Profile are injected for the resolved tenant API schema.",
] as const;
