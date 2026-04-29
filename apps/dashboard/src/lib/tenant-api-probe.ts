import { fluxApiUrlForSlug } from "@flux/core";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

const PROBE_TIMEOUT_MS = 5_000;

/**
 * When set (e.g. `http://flux-node-gateway:4000`), tenant health probes from the
 * dashboard (fleet monitor, v2 "start" power) issue HTTP to this base URL and set
 * the `Host` header to the public tenant API hostname (`api.<slug>.<hash>.<domain>`).
 *
 * Without this, `fetch("https://api…")` from inside `flux-web` often fails in production
 * (TLS / wildcard depth for extra labels, split-horizon DNS, or hairpin NAT) even when
 * Traefik and the gateway are healthy.
 */
function tenantProbeGatewayBase(): string | null {
  const u = process.env.FLUX_TENANT_PROBE_GATEWAY_URL?.trim();
  return u && u.length > 0 ? u : null;
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
): Promise<boolean> {
  const publicUrl = fluxApiUrlForSlug(slug, hash, isProduction);
  const via = tenantProbeGatewayBase();
  if (via) {
    return probeThroughGateway(new URL(publicUrl), via);
  }
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
