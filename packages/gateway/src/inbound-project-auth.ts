import { mintBridgeJwt, mintBridgedTenantJwt } from "./jwt-issuer.ts";
import { fetchProjectJwtSecret } from "./tenant-resolver.ts";
import type { TenantResolution } from "./types.ts";

export type InboundProjectAuthResult =
  | { ok: true; downstreamJwt: string }
  | { ok: false; status: 401; error: string }
  | { ok: false; status: 503; error: string };

/**
 * Verifies the inbound Authorization Bearer token (project JWT) and mints the
 * pool-signed bridge JWT for PostgREST. Missing or invalid client auth fails closed.
 */
export async function verifyInboundProjectBearer(
  authorizationHeader: string | undefined,
  tenant: TenantResolution,
): Promise<InboundProjectAuthResult> {
  const authz = authorizationHeader?.trim();
  if (!authz?.toLowerCase().startsWith("bearer ")) {
    return { ok: false, status: 401, error: "authorization required" };
  }
  const token = authz.slice(7).trim();
  if (!token) {
    return { ok: false, status: 401, error: "authorization required" };
  }

  let projectSecret = tenant.jwtSecret;
  if (projectSecret == null) {
    projectSecret = await fetchProjectJwtSecret(tenant.projectId);
  }
  if (projectSecret == null) {
    return {
      ok: false,
      status: 503,
      error: "project jwt_secret missing; run repair on the control plane",
    };
  }

  try {
    const bridged = await mintBridgeJwt(token, projectSecret);
    const downstreamJwt = await mintBridgedTenantJwt(tenant, bridged.claims);
    return { ok: true, downstreamJwt };
  } catch {
    return { ok: false, status: 401, error: "invalid or expired token" };
  }
}
