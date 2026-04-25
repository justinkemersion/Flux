import { SignJWT } from "jose";
import { env } from "./env.ts";

const encoder = new TextEncoder();

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
  const secret = encoder.encode(env.FLUX_GATEWAY_JWT_SECRET);
  const now = Math.floor(Date.now() / 1000);
  const ttl = env.FLUX_GATEWAY_JWT_TTL_SEC;

  return new SignJWT({
    role: `t_${tenant.shortid}_role`,
    tenant_id: tenant.tenantId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setNotBefore(now - 5)
    .setExpirationTime(now + ttl)
    .sign(secret);
}
