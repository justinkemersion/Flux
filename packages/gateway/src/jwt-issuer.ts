import { defaultTenantRoleFromProjectId } from "@flux/core/api-schema-strategy";
import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import { env } from "./env.ts";

const encoder = new TextEncoder();
/**
 * Pool-only HS256 key shared with `flux-postgrest-pool` (`PGRST_JWT_SECRET`).
 * Distinct from per-project `projects.jwt_secret` (tenant-issued JWT verification).
 */
const SECRET_BYTES = encoder.encode(env.FLUX_GATEWAY_JWT_SECRET);
const JWT_CACHE_MAX_TTL_SEC = 300;
const BRIDGE_TOKEN_TTL = "5m";

export type BridgeTokenClaims = {
  sub: string;
  email: string | null;
  role: "authenticated";
};

type JwtCacheEntry = {
  token: string;
  expiresAtSec: number;
};

/**
 * Local token reuse cache keyed by tenant UUID.
 *
 * Reuses an already-signed JWT while it is still valid to avoid paying signing
 * cost on every request for hot tenants.
 */
const jwtCache = new Map<string, JwtCacheEntry>();

/**
 * Mints a short-lived HS256 JWT for a resolved tenant.
 *
 * Claims (per architecture spec invariant 3 — gateway is sole issuer):
 *   role      — PostgREST uses this to SET ROLE at query time
 *   tenant_id — opaque identifier forwarded to PostgREST
 *   iat       — issued-at (Unix seconds)
 *   nbf       — 5-second back-skew to tolerate minor clock drift
 *   exp       — expiry (iat + FLUX_GATEWAY_JWT_TTL_SEC)
 */
export async function mintJwt(tenant: {
  tenantId: string;
  shortid: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const cached = jwtCache.get(tenant.tenantId);
  if (cached && cached.expiresAtSec > now) {
    return cached.token;
  }

  const ttl = env.FLUX_GATEWAY_JWT_TTL_SEC;
  const effectiveTtl = Math.min(ttl, JWT_CACHE_MAX_TTL_SEC);
  const expiresAtSec = now + effectiveTtl;

  const token = await new SignJWT({
    role: defaultTenantRoleFromProjectId(tenant.tenantId),
    tenant_id: tenant.tenantId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setNotBefore(now - 5)
    .setExpirationTime(expiresAtSec)
    .sign(SECRET_BYTES);

  jwtCache.set(tenant.tenantId, { token, expiresAtSec });
  return token;
}

export function sanitizeExternalClaims(payload: JWTPayload): BridgeTokenClaims {
  const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (!sub) {
    throw new Error("missing sub claim");
  }

  return {
    sub,
    email: typeof payload.email === "string" ? payload.email : null,
    role: "authenticated",
  };
}

export async function mintBridgeJwt(
  externalToken: string,
  projectSecret: string,
): Promise<{ claims: BridgeTokenClaims }> {
  const verified = await jwtVerify(externalToken, encoder.encode(projectSecret), {
    algorithms: ["HS256"],
  });
  const claims = sanitizeExternalClaims(verified.payload);
  return { claims };
}

/**
 * Pool JWT after bridge auth: tenant role (v2_shared) + stable `sub` for RLS.
 */
export async function mintBridgedTenantJwt(
  tenant: { tenantId: string },
  claims: BridgeTokenClaims,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const body: Record<string, string> = {
    role: defaultTenantRoleFromProjectId(tenant.tenantId),
    tenant_id: tenant.tenantId,
    sub: claims.sub,
  };
  if (claims.email) {
    body.email = claims.email;
  }
  return new SignJWT(body)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setNotBefore(now - 5)
    .setExpirationTime(BRIDGE_TOKEN_TTL)
    .sign(SECRET_BYTES);
}
