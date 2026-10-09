import {
  type FluxCatalogProjectMode,
  fluxApiUrlForCatalog,
  postgrestContainerName,
  V2_GATEWAY_AUTH_REQUIRED_ERROR,
} from "@flux/core";
import { SignJWT } from "jose";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

export type TenantProbeTarget = {
  kind: "gateway" | "dedicated-container" | "public";
  url: string;
  headers: Record<string, string>;
};

export type TenantProbeTransport = (
  target: TenantProbeTarget,
) => Promise<number | null>;

export type TenantApiProbeOptions = {
  bearerToken?: string;
  /** When true, only 2xx/3xx count (used for v2 fleet JWT deep probe). */
  requireAuthenticatedSuccess?: boolean;
  /** PostgREST OpenAPI root expects a JSON-family Accept header. */
  accept?: string;
  /** Archived projects are not probed. */
  lifecycleState?: string | null;
  /** Test hook. Production uses gateway HTTP for v2 and fetch otherwise. */
  transport?: TenantProbeTransport;
};

/**
 * Dedicated PostgREST has no `/health` route. `GET /health` is a table lookup
 * (`relation "…health" does not exist`) and shows up as 404 noise. `GET /` is
 * the OpenAPI root and does not name a table.
 */
export const DEDICATED_POSTGREST_PROBE_PATH = "/";

export function isArchivedProjectLifecycle(
  lifecycleState: string | null | undefined,
): boolean {
  return lifecycleState === "archived";
}

const FLEET_PROBE_JWT_SUB = "flux-fleet-probe";
const FLEET_PROBE_JWT_TTL = "5m";

const PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_GATEWAY_PROBE_URL = "http://flux-node-gateway:4000";

/**
 * When set (e.g. `http://flux-node-gateway:4000`), **v2_shared** health probes from the
 * dashboard (fleet monitor, v2 "start" power) issue HTTP to this base URL and set
 * the `Host` header to the public tenant API hostname (canonical flattened
 * `api--<slug>--<hash>.<domain>`). The node gateway only routes `v2_shared`.
 *
 * `v1_dedicated` is not sent here. The gateway answers those hosts with 502.
 * Dedicated probes use the tenant PostgREST container on the Docker network
 * (`http://flux-<hash>-<slug>-api:3000/`), then the public API origin. The path
 * is {@link DEDICATED_POSTGREST_PROBE_PATH}, not `/health`.
 *
 * Without the gateway base, `fetch("https://api…")` from inside `flux-web` often
 * fails in production (TLS / wildcard depth for extra labels, split-horizon DNS,
 * or hairpin NAT) even when Traefik and the gateway are healthy.
 *
 * v2_shared shallow probes (see {@link tenantProbeShallowAllowed}) treat HTTP 401 as success.
 * Default fleet/catalog probes use {@link probeV2SharedCatalogProject} (JWT + 2xx).
 * Archived projects are not probed.
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

/** Re-export for dashboard tests and fleet probes — canonical in `@flux/core/v2-api-contract`. */
export { V2_GATEWAY_AUTH_REQUIRED_ERROR };

/**
 * Fleet / lifecycle probes treat HTTP status as reachability, not full API auth.
 * v2_shared: 401 on tenant routes means the gateway resolved the host and enforced
 * Pass 1A auth — healthy for mesh status. v1 and unresolved hosts stay strict.
 */
export function isTenantProbeSuccess(
  statusCode: number,
  mode: FluxCatalogProjectMode,
  options?: { requireAuthenticatedSuccess?: boolean },
): boolean {
  if (statusCode >= 200 && statusCode < 400) {
    return true;
  }
  if (options?.requireAuthenticatedSuccess) {
    return false;
  }
  if (mode === "v2_shared" && statusCode === 401) {
    return true;
  }
  return false;
}

/** Restore Pass 1A mesh semantics (401 without Bearer = healthy). Off by default. */
export function tenantProbeShallowAllowed(): boolean {
  const v = process.env.FLUX_TENANT_PROBE_SHALLOW?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Short-lived HS256 project JWT for fleet/catalog deep probes (not for apps). */
export async function mintFleetProbeProjectJwt(jwtSecret: string): Promise<string> {
  const secret = jwtSecret.trim();
  return new SignJWT({ sub: FLEET_PROBE_JWT_SUB, role: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(FLEET_PROBE_JWT_TTL)
    .sign(new TextEncoder().encode(secret));
}

/**
 * v2_shared catalog probe: requires `jwt_secret`, then gateway + PostgREST with a minted JWT.
 * Returns false when secret is missing (no 401-as-healthy fallback unless shallow mode).
 */
export async function probeV2SharedCatalogProject(options: {
  slug: string;
  hash: string;
  isProduction: boolean;
  jwtSecret: string | null | undefined;
  lifecycleState?: string | null;
  transport?: TenantProbeTransport;
}): Promise<boolean> {
  if (isArchivedProjectLifecycle(options.lifecycleState)) {
    return false;
  }
  const secret = options.jwtSecret?.trim();
  if (!secret) {
    return false;
  }
  const shared: TenantApiProbeOptions = {
    lifecycleState: options.lifecycleState,
    ...(options.transport ? { transport: options.transport } : {}),
  };
  if (tenantProbeShallowAllowed()) {
    return probeTenantApiUrl(
      options.slug,
      options.hash,
      options.isProduction,
      "v2_shared",
      shared,
    );
  }
  const bearer = await mintFleetProbeProjectJwt(secret);
  return probeTenantApiUrl(
    options.slug,
    options.hash,
    options.isProduction,
    "v2_shared",
    {
      ...shared,
      bearerToken: bearer,
      requireAuthenticatedSuccess: true,
      accept: "application/json",
    },
  );
}

/**
 * Where a fleet probe will send HTTP. Dedicated mode never lists the node gateway.
 * v2 lists each configured gateway base, then the public origin.
 */
export function buildTenantProbePlan(input: {
  slug: string;
  hash: string;
  isProduction: boolean;
  mode: FluxCatalogProjectMode;
  gatewayBases: readonly string[];
  headers?: Record<string, string>;
}): TenantProbeTarget[] {
  const headers = input.headers ?? {};
  const publicOrigin = fluxApiUrlForCatalog(
    input.slug,
    input.hash,
    input.isProduction,
    input.mode,
  );
  if (input.mode !== "v2_shared") {
    const containerUrl = `http://${postgrestContainerName(input.hash, input.slug)}:3000${DEDICATED_POSTGREST_PROBE_PATH}`;
    const publicUrl = new URL(publicOrigin);
    publicUrl.pathname = DEDICATED_POSTGREST_PROBE_PATH;
    publicUrl.search = "";
    publicUrl.hash = "";
    return [
      { kind: "dedicated-container", url: containerUrl, headers },
      { kind: "public", url: publicUrl.toString(), headers },
    ];
  }

  const tenantUrl = new URL(publicOrigin);
  const targets: TenantProbeTarget[] = [];
  const path = `${tenantUrl.pathname || "/"}${tenantUrl.search}` || "/";
  for (const base of input.gatewayBases) {
    let gatewayBase: URL;
    try {
      gatewayBase = new URL(base);
    } catch {
      continue;
    }
    const suffix = path.startsWith("/") ? path : `/${path}`;
    targets.push({
      kind: "gateway",
      url: `${gatewayBase.origin}${suffix}`,
      headers: { ...headers, host: tenantUrl.host },
    });
  }
  targets.push({ kind: "public", url: publicOrigin, headers });
  return targets;
}

/**
 * Returns true when the tenant API edge is reachable (2xx/3xx, or v2 gateway 401 auth gate).
 */
export async function probeTenantApiUrl(
  slug: string,
  hash: string,
  isProduction: boolean,
  mode: FluxCatalogProjectMode,
  probeOptions?: TenantApiProbeOptions,
): Promise<boolean> {
  if (isArchivedProjectLifecycle(probeOptions?.lifecycleState)) {
    return false;
  }
  const headers: Record<string, string> = {};
  if (probeOptions?.bearerToken) {
    headers.authorization = `Bearer ${probeOptions.bearerToken}`;
  }
  if (probeOptions?.accept) {
    headers.accept = probeOptions.accept;
  }
  const plan = buildTenantProbePlan({
    slug,
    hash,
    isProduction,
    mode,
    gatewayBases: mode === "v2_shared" ? tenantProbeGatewayBases() : [],
    headers,
  });
  const transport = probeOptions?.transport ?? defaultTenantProbeTransport;
  for (const target of plan) {
    const status = await transport(target);
    if (
      status != null &&
      isTenantProbeSuccess(status, mode, {
        requireAuthenticatedSuccess: probeOptions?.requireAuthenticatedSuccess,
      })
    ) {
      return true;
    }
  }
  return false;
}

async function defaultTenantProbeTransport(
  target: TenantProbeTarget,
): Promise<number | null> {
  if (target.kind === "gateway") return probeGatewayTarget(target);
  return probeFetchStatus(target.url, target.headers);
}

async function probeFetchStatus(
  url: string,
  headers: Record<string, string>,
): Promise<number | null> {
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers,
    });
    return res.status;
  } catch {
    return null;
  }
}

function probeGatewayTarget(target: TenantProbeTarget): Promise<number | null> {
  let gatewayBase: URL;
  try {
    gatewayBase = new URL(target.url);
  } catch {
    return Promise.resolve(null);
  }
  const isHttps = gatewayBase.protocol === "https:";
  const mod = isHttps ? https : http;
  const port = gatewayBase.port
    ? Number(gatewayBase.port)
    : isHttps
      ? 443
      : 80;
  const path = `${gatewayBase.pathname}${gatewayBase.search}` || "/";
  const hostHeader = target.headers.host ?? gatewayBase.host;

  return new Promise((resolve) => {
    const req = mod.request(
      {
        hostname: gatewayBase.hostname,
        port,
        path,
        method: "GET",
        timeout: PROBE_TIMEOUT_MS,
        headers: {
          ...target.headers,
          host: hostHeader,
        },
      },
      (res) => {
        const code = res.statusCode ?? 0;
        res.resume();
        resolve(code);
      },
    );
    req.on("error", () => {
      resolve(null);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}
