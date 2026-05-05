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

function isProbeSuccessStatus(code: number): boolean {
  return code >= 200 && code < 400;
}

/**
 * Returns true if the tenant PostgREST edge responds with a 2xx/3xx (same semantics as
 * the previous `fetch` probe: success = reachable and not 4xx/5xx from our perspective).
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
    if (await probeThroughGateway(tenantUrl, via)) {
      return true;
    }
  }
  // Final fallback: probe the public URL directly.
  return probeWithFetch(publicUrl);
}

async function probeWithFetch(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return isProbeSuccessStatus(res.status);
  } catch {
    return false;
  }
}

function probeThroughGateway(
  tenantUrl: URL,
  gatewayBaseRaw: string,
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
        resolve(isProbeSuccessStatus(code));
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
