import {
  type FluxCatalogProjectMode,
  fluxApiUrlForCatalog,
} from "@flux/core";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

const PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_GATEWAY_PROBE_URL = "http://flux-node-gateway:4000";

/**
 * When set (e.g. `http://flux-node-gateway:4000`), tenant health probes from the
 * dashboard (fleet monitor, v2 "start" power) issue HTTP to this base URL and set
 * the `Host` header to the public tenant API hostname (canonical flattened
 * `api--<slug>--<hash>.<domain>` for both engines; the gateway resolves it for `v2_shared`).
 *
 * Without this, `fetch("https://api…")` from inside `flux-web` often fails in production
 * (TLS / wildcard depth for extra labels, split-horizon DNS, or hairpin NAT) even when
 * Traefik and the gateway are healthy.
 *
 * v2_shared probes intentionally treat HTTP 401 (missing project Bearer) as success —
 * the gateway resolved the tenant and enforced auth; see {@link isTenantProbeSuccess}.
 */
function tenantProbeGatewayBases(): string[] {
  const configured = process.env.FLUX_TENANT_PROBE_GATEWAY_URL?.trim();
  const bases: string[] = [];
  if (configured && configured.length > 0) {
    bases.push(configured);
  }
  // In production Compose deployments, this service is typically reachable over
  // the shared `flux-network`; keeping it as a fallback reduces false "offline"
  // status when env wiring is missing.
  if (
    process.env.NODE_ENV === "production" &&
    !bases.includes(DEFAULT_GATEWAY_PROBE_URL)
  ) {
    bases.push(DEFAULT_GATEWAY_PROBE_URL);
  }
  return bases;
}

/**
 * 401 body when the v2 gateway resolved the tenant but no project Bearer was sent.
 * Keep aligned with `packages/gateway/src/inbound-project-auth.ts`.
 */
export const V2_GATEWAY_AUTH_REQUIRED_ERROR = "authorization required";

/**
 * Fleet / lifecycle probes treat HTTP status as reachability, not full API auth.
 * v2_shared: 401 on tenant routes means the gateway resolved the host and enforced
 * Pass 1A auth — healthy for mesh status. v1 and unresolved hosts stay strict.
 */
export function isTenantProbeSuccess(
  statusCode: number,
  mode: FluxCatalogProjectMode,
): boolean {
  if (statusCode >= 200 && statusCode < 400) {
    return true;
  }
  if (mode === "v2_shared" && statusCode === 401) {
    return true;
  }
  return false;
}

/**
 * Returns true when the tenant API edge is reachable (2xx/3xx, or v2 gateway 401 auth gate).
 */
export async function probeTenantApiUrl(
  slug: string,
  hash: string,
  isProduction: boolean,
  mode: FluxCatalogProjectMode,
): Promise<boolean> {
  const publicUrl = fluxApiUrlForCatalog(slug, hash, isProduction, mode);
  const tenantUrl = new URL(publicUrl);
  for (const via of tenantProbeGatewayBases()) {
    if (await probeThroughGateway(tenantUrl, via, mode)) {
      return true;
    }
  }
  // Final fallback: probe the public URL directly.
  return probeWithFetch(publicUrl, mode);
}

async function probeWithFetch(
  url: string,
  mode: FluxCatalogProjectMode,
): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return isTenantProbeSuccess(res.status, mode);
  } catch {
    return false;
  }
}

function probeThroughGateway(
  tenantUrl: URL,
  gatewayBaseRaw: string,
  mode: FluxCatalogProjectMode,
): Promise<boolean> {
  let gatewayBase: URL;
  try {
    gatewayBase = new URL(gatewayBaseRaw);
  } catch {
    return Promise.resolve(false);
  }
  const isHttps = gatewayBase.protocol === "https:";
  const mod = isHttps ? https : http;
  const path = `${tenantUrl.pathname || "/"}${tenantUrl.search}`;
  const port = gatewayBase.port
    ? Number(gatewayBase.port)
    : isHttps
      ? 443
      : 80;
  const hostHeader = tenantUrl.host;

  return new Promise((resolve) => {
    const req = mod.request(
      {
        hostname: gatewayBase.hostname,
        port,
        path: path || "/",
        method: "GET",
        timeout: PROBE_TIMEOUT_MS,
        headers: {
          host: hostHeader,
        },
      },
      (res) => {
        const code = res.statusCode ?? 0;
        res.resume();
        resolve(isTenantProbeSuccess(code, mode));
      },
    );
    req.on("error", () => {
      resolve(false);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}
