import { SignJWT } from "jose";
import { env } from "./env.ts";

const encoder = new TextEncoder();
/**
 * Encoded once at module load — re-encoding on every call wastes CPU for no
 * reason since the secret never changes at runtime.
 */
const SECRET_BYTES = encoder.encode(env.FLUX_GATEWAY_JWT_SECRET);
const JWT_CACHE_MAX_TTL_SEC = 300;

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
    role: `t_${tenant.shortid}_role`,
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
