import { fluxApiUrlForSlug } from "@flux/core";
import { SignJWT } from "jose";
import { Agent, fetch as undiciFetch } from "undici";

/**
 * Controls PostgREST smoke validation after restore (before catalog switch).
 *
 * - `off` / `0` / `false` / `no`: skip entirely (local/CI when the API URL is not reachable from the control plane).
 * - `strict` / `1` / `true` / `on`: require a successful OpenAPI probe; **any** fetch or HTTP failure fails migration.
 * - `auto` or unset: probe OpenAPI; HTTP 4xx/5xx fails migration; connection-level errors log a warning and continue.
 */
export function postgrestMigrateValidateMode(): "off" | "auto" | "strict" {
  const v = process.env.FLUX_MIGRATE_POSTGREST_VALIDATE?.trim().toLowerCase();
  if (!v || v === "auto") return "auto";
  if (v === "0" || v === "false" || v === "off" || v === "no") return "off";
  if (v === "1" || v === "true" || v === "on" || v === "strict") return "strict";
  return "auto";
}

function insecureTlsAgent(): Agent | undefined {
  const o = process.env.FLUX_MIGRATE_POSTGREST_INSECURE_TLS?.trim().toLowerCase();
  if (o !== "1" && o !== "true" && o !== "yes") return undefined;
  return new Agent({ connect: { rejectUnauthorized: false } });
}

async function mintDedicatedServiceRoleJwt(secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return await new SignJWT({ role: "service_role" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("120s")
    .sign(key);
}

function isLikelyUnreachableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  if (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN"
  ) {
    return true;
  }
  const m = err.message.toLowerCase();
  if (m.includes("certificate") || m.includes("ssl") || m.includes("tls")) {
    return true;
  }
  if (m.includes("fetch failed") || m.includes("network")) {
    return true;
  }
  return false;
}

/**
 * Proves the dedicated PostgREST stack accepts the tenant `jwt_secret` and exposes the migrated
 * schema (OpenAPI root with `Accept-Profile`).
 */
export async function validateDedicatedPostgrestOpenApi(input: {
  slug: string;
  hash: string;
  isProduction: boolean;
  jwtSecret: string;
  tenantSchema: string;
}): Promise<void> {
  const mode = postgrestMigrateValidateMode();
  if (mode === "off") return;

  const base = fluxApiUrlForSlug(
    input.slug,
    input.hash,
    input.isProduction,
  ).replace(/\/$/, "");
  const url = `${base}/`;
  const token = await mintDedicatedServiceRoleJwt(input.jwtSecret.trim());
  const dispatcher = insecureTlsAgent();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/openapi+json",
    "Accept-Profile": input.tenantSchema,
  };

  try {
    const res = await undiciFetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(20_000),
      ...(dispatcher ? { dispatcher } : {}),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `PostgREST OpenAPI probe failed: HTTP ${String(res.status)} ${body.slice(0, 400)}`,
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (mode === "strict" || !isLikelyUnreachableError(err)) {
      throw new Error(
        `PostgREST validation failed (${mode}): ${msg}`,
      );
    }
    console.warn(
      `[flux migrate] PostgREST OpenAPI probe skipped (unreachable in auto mode): ${msg}`,
    );
  }
}
