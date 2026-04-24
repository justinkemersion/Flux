import "server-only";
import { createHash } from "node:crypto";
import Redis from "ioredis";

export { CODEX_INFERENCE_QUOTA_EXCEEDED_MESSAGE } from "@/src/lib/codex-inference-messages";

/** Fixed window for inference counting (seconds). */
export const CODEX_INFERENCE_WINDOW_SEC = 3600;

/** Default cap: Codex / Workers AI calls per window per subject. */
export const DEFAULT_CODEX_INFERENCE_PER_HOUR = 20;

/**
 * Per-plan limits (v2: "squeeze" tightens on shared tiers vs room on dedicated).
 * When billing exposes project plan, pass the key into {@link acquireCodexInferenceSlot}.
 * Until then the action uses `default`.
 */
export const CODEX_INFERENCE_TIER_LIMITS: Record<string, number> = {
  default: DEFAULT_CODEX_INFERENCE_PER_HOUR,
  free: DEFAULT_CODEX_INFERENCE_PER_HOUR,
  pro: DEFAULT_CODEX_INFERENCE_PER_HOUR,
  enterprise: DEFAULT_CODEX_INFERENCE_PER_HOUR,
};

const KEY_PREFIX = "codex:infer:1h";

type GlobalWithRedis = typeof globalThis & { __fluxCodexRedis?: Redis | null };

function getRedisUrl(): string | undefined {
  return (
    process.env.FLUX_REDIS_URL?.trim() ||
    process.env.REDIS_URL?.trim() ||
    undefined
  );
}

let shared: Redis | null | undefined;

function getSharedRedis(): Redis | null {
  if (shared !== undefined) {
    return shared;
  }
  const url = getRedisUrl();
  if (!url) {
    shared = null;
    return null;
  }
  const g = globalThis as GlobalWithRedis;
  if (g.__fluxCodexRedis) {
    shared = g.__fluxCodexRedis;
    return shared;
  }
  const client = new Redis(url, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  g.__fluxCodexRedis = client;
  shared = client;
  return client;
}

export function getCodexInferenceLimitForTier(tier: string | undefined): number {
  if (!tier) {
    return CODEX_INFERENCE_TIER_LIMITS.default;
  }
  const k = tier.toLowerCase();
  return CODEX_INFERENCE_TIER_LIMITS[k] ?? CODEX_INFERENCE_TIER_LIMITS.default;
}

/** First public IP from X-Forwarded-For / X-Real-IP; empty if unknown. */
export function extractClientIpFromHeaders(h: Headers): string {
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  const real = h.get("x-real-ip")?.trim();
  if (real) {
    return real;
  }
  return "";
}

function redisKeyForSubject(params: {
  userId?: string | null;
  clientIp: string;
}): string {
  if (params.userId) {
    return `${KEY_PREFIX}:u:${params.userId}`;
  }
  const ip = params.clientIp || "unknown";
  const h = createHash("sha256").update(ip).digest("hex").slice(0, 32);
  return `${KEY_PREFIX}:ip:${h}`;
}

export type CodexInferenceSlotResult =
  | { allowed: true; failOpen?: boolean }
  | { allowed: false; reason: "quota" };

/**
 * Token-bucket style counter: `INCR` per subject; first increment sets window TTL.
 * FAIL-OPEN: Redis errors log `[SYS_ERR]` and allow the inference to proceed.
 */
export async function acquireCodexInferenceSlot(params: {
  userId?: string | null;
  clientIp: string;
  /** Billing / project plan key; optional until wired. */
  tier?: string | null;
}): Promise<CodexInferenceSlotResult> {
  const limit = getCodexInferenceLimitForTier(params.tier ?? undefined);
  const key = redisKeyForSubject({
    userId: params.userId,
    clientIp: params.clientIp,
  });
  const client = getSharedRedis();
  if (!client) {
    return { allowed: true, failOpen: true };
  }

  try {
    const n = await client.incr(key);
    if (n === 1) {
      await client.expire(key, CODEX_INFERENCE_WINDOW_SEC);
    }
    if (n > limit) {
      return { allowed: false, reason: "quota" };
    }
    return { allowed: true };
  } catch (err) {
    console.error(
      "[SYS_ERR] codex inference throttler (Redis); fail-open:",
      err,
    );
    return { allowed: true, failOpen: true };
  }
}
