import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { apiKeys } from "@/src/db/schema";
import type { SystemDb } from "@/src/lib/db";

/** Live CLI key family — prefix is regex-stable for gateways before DB lookup. */
export const FLUX_CLI_KEY_PREFIX = "flx_live" as const;

/** `flx_live_<32 hex random>_<4 hex checksum>` — checksum = first 4 hex chars of SHA-256(prefix_random32). */
const FLUX_CLI_KEY_REGEX = /^flx_live_([a-f0-9]{32})_([a-f0-9]{4})$/i;

const DEFAULT_LAST_USED_THROTTLE_MS = 60 * 60 * 1000;

export function checksumForFluxKeyRandom(random32Lower: string): string {
  return createHash("sha256")
    .update(`${FLUX_CLI_KEY_PREFIX}_${random32Lower}`, "utf8")
    .digest("hex")
    .slice(0, 4)
    .toLowerCase();
}

/**
 * Validates shape + checksum without touching the DB (reject noise early on small VPS).
 */
export function parseFluxCliKey(token: string): { random32: string } | null {
  const m = token.trim().match(FLUX_CLI_KEY_REGEX);
  if (!m?.[1] || !m[2]) return null;
  const random32 = m[1].toLowerCase();
  const expected = checksumForFluxKeyRandom(random32);
  if (m[2].toLowerCase() !== expected) return null;
  return { random32 };
}

export function hashFluxCliKeySecret(token: string): string {
  return createHash("sha256").update(token.trim(), "utf8").digest("hex");
}

/** Issue a new key (show once to the user; persist only {@link hashFluxCliKeySecret}). */
export function generateFluxCliKey(): string {
  const random32 = randomBytes(16).toString("hex").toLowerCase();
  const checksum = checksumForFluxKeyRandom(random32);
  return `${FLUX_CLI_KEY_PREFIX}_${random32}_${checksum}`;
}

export function extractBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(\S+)/i.exec(authorization.trim());
  return m?.[1] ?? null;
}

export type CliApiAuthResult = { userId: string; keyId: string };

/**
 * Validates `flx_live_…` Bearer token, resolves `userId`, optionally bumps `last_used_at`
 * at most once per {@link throttleLastUsedMs} (default 1 hour) to limit write amplification.
 */
export async function authenticateCliApiKey(
  db: SystemDb,
  bearerSecret: string | null | undefined,
  options?: { throttleLastUsedMs?: number },
): Promise<CliApiAuthResult | null> {
  if (!bearerSecret || typeof bearerSecret !== "string") return null;
  const token = bearerSecret.trim();
  if (!token.startsWith(FLUX_CLI_KEY_PREFIX)) return null;
  if (parseFluxCliKey(token) === null) return null;

  const keyHash = hashFluxCliKeySecret(token);
  const rows = await db
    .select({ id: apiKeys.id, userId: apiKeys.userId })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const throttleMs = options?.throttleLastUsedMs ?? DEFAULT_LAST_USED_THROTTLE_MS;
  const cutoff = new Date(Date.now() - throttleMs);

  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, row.id),
        or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, cutoff)),
      ),
    );

  return { userId: row.userId, keyId: row.id };
}
