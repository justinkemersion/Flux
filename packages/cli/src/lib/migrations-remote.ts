import { createHmac } from "node:crypto";
import type { FluxMigrationRecord } from "@flux/core/sql-migrations";
import { getApiClient } from "../api-client";
import { resolveDashboardBase } from "../dashboard-base";
import { readEnvFile } from "../utils/env-file";

export function formatV2ServerError(status: number, body: unknown): string {
  const obj = (body && typeof body === "object" ? body : {}) as Record<
    string,
    unknown
  >;
  const message =
    typeof obj.error === "string" && obj.error.trim()
      ? obj.error
      : `Request failed (${String(status)})`;
  const tail: string[] = [];
  if (typeof obj.sqlState === "string") tail.push(`SQLSTATE ${obj.sqlState}`);
  if (typeof obj.position === "string") tail.push(`position ${obj.position}`);
  if (typeof obj.hint === "string") tail.push(`hint: ${obj.hint}`);
  if (tail.length === 0) return message;
  return `${message} (${tail.join("; ")})`;
}

export async function resolveProjectJwtSecret(): Promise<string> {
  const fromEnv = process.env.FLUX_GATEWAY_JWT_SECRET?.trim();
  if (fromEnv) return fromEnv;
  const dotenv = await readEnvFile(process.cwd());
  const fromFile = dotenv.FLUX_GATEWAY_JWT_SECRET?.trim();
  if (fromFile) return fromFile;
  throw new Error(
    "FLUX_GATEWAY_JWT_SECRET is not set. Run `flux project credentials` and paste the printed line into your local .env (same value as the project's jwt_secret).",
  );
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/=+$/u, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function mintServiceRoleJwt(secret: string, hash: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    role: "service_role",
    hash,
    iat: now,
    nbf: now - 5,
    exp: now + 60,
  };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = base64UrlEncode(
    createHmac("sha256", secret).update(signingInput).digest(),
  );
  return `${signingInput}.${signature}`;
}

async function listAppliedMigrationsV2(input: {
  slug: string;
  hash: string;
}): Promise<FluxMigrationRecord[]> {
  const secret = await resolveProjectJwtSecret();
  const token = mintServiceRoleJwt(secret, input.hash);
  const base = resolveDashboardBase();
  const url = new URL(
    `/api/projects/${encodeURIComponent(input.slug)}/migrations`,
    base.endsWith("/") ? base : `${base}/`,
  );
  url.searchParams.set("hash", input.hash);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text.trim() ? (JSON.parse(text) as unknown) : null;
  } catch {
    throw new Error(
      `flux migrations: list was not JSON (${String(res.status)}).`,
    );
  }
  if (!res.ok) {
    throw new Error(formatV2ServerError(res.status, body));
  }
  if (
    !body ||
    typeof body !== "object" ||
    !("applied" in body) ||
    !Array.isArray((body as { applied: unknown }).applied)
  ) {
    throw new Error("flux migrations: unexpected list response.");
  }
  return (body as { applied: FluxMigrationRecord[] }).applied;
}

export async function fetchAppliedMigrations(input: {
  slug: string;
  hash: string;
  mode: string;
}): Promise<FluxMigrationRecord[]> {
  if (input.mode === "v2_shared") {
    return listAppliedMigrationsV2(input);
  }
  const client = getApiClient();
  return client.listAppliedMigrations(input.hash);
}
