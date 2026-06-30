/**
 * Fixed-window rate limiter for `/api/cli/v1/*` (in-memory; testable without Redis).
 *
 * Keys by CLI key material hash when a Bearer token is present, else `anon`.
 * Write/sensitive tiers fail closed when storage is marked unavailable.
 * Read tier may fail open with a stderr warning when storage is unavailable.
 * Audit tier uses a separate high allowance so audit persistence cannot starve itself.
 */

import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { extractBearerToken } from "./cli-api-auth";

export type CliRateLimitTier = "read" | "write" | "sensitive" | "audit";

export interface CliRateLimitConfig {
  limit: number;
  windowMs: number;
}

export interface CliRateLimitAcquireResult {
  allowed: boolean;
  tier: CliRateLimitTier;
  retryAfterSec: number;
  limit: number;
  remaining: number;
}

interface WindowBucket {
  count: number;
  windowStartMs: number;
}

const DEFAULT_WINDOWS: Record<CliRateLimitTier, CliRateLimitConfig> = {
  read: { limit: 120, windowMs: 60_000 },
  write: { limit: 30, windowMs: 60_000 },
  sensitive: { limit: 20, windowMs: 60_000 },
  audit: { limit: 600, windowMs: 60_000 },
};

let buckets = new Map<string, WindowBucket>();
let storageAvailable = true;
let windows = { ...DEFAULT_WINDOWS };

export function resetCliRateLimitStateForTests(): void {
  buckets = new Map();
  storageAvailable = true;
  windows = { ...DEFAULT_WINDOWS };
}

export function setCliRateLimitStorageAvailable(available: boolean): void {
  storageAvailable = available;
}

export function setCliRateLimitWindowsForTests(
  overrides: Partial<Record<CliRateLimitTier, CliRateLimitConfig>>,
): void {
  windows = { ...DEFAULT_WINDOWS, ...overrides };
}

export function classifyCliRoute(pathname: string, method: string): CliRateLimitTier {
  const path = pathname.replace(/\/+$/, "");
  const verb = method.toUpperCase();

  if (path === "/api/cli/v1/audit" && verb === "POST") {
    return "audit";
  }

  if (verb === "GET" || verb === "HEAD") {
    return "read";
  }

  const sensitivePatterns = [
    "/api/cli/v1/intents",
    "/api/cli/v1/push",
    "/api/cli/v1/migrate",
    "/db-access/temporary-credential",
    "/query",
    "/backups/",
    "/lifecycle",
    "/credentials",
    "/dump",
  ];
  if (sensitivePatterns.some((p) => path.includes(p))) {
    return "sensitive";
  }

  return "write";
}

export function rateLimitKeyFromRequest(req: NextRequest): string {
  const token = extractBearerToken(req.headers.get("authorization"));
  if (!token) return "anon";
  return createHash("sha256").update(token.trim(), "utf8").digest("hex").slice(0, 32);
}

function bucketKey(identityKey: string, tier: CliRateLimitTier): string {
  return `${tier}:${identityKey}`;
}

export function acquireCliRateSlot(
  identityKey: string,
  tier: CliRateLimitTier,
): CliRateLimitAcquireResult {
  const config = windows[tier];
  const now = Date.now();

  if (!storageAvailable) {
    if (tier === "read") {
      console.warn(
        "[flux] CLI rate-limit storage unavailable; failing open for read tier.",
      );
      return {
        allowed: true,
        tier,
        retryAfterSec: 0,
        limit: config.limit,
        remaining: config.limit,
      };
    }
    return {
      allowed: false,
      tier,
      retryAfterSec: Math.ceil(config.windowMs / 1000),
      limit: config.limit,
      remaining: 0,
    };
  }

  const key = bucketKey(identityKey, tier);
  const existing = buckets.get(key);
  if (!existing || now - existing.windowStartMs >= config.windowMs) {
    buckets.set(key, { count: 1, windowStartMs: now });
    return {
      allowed: true,
      tier,
      retryAfterSec: 0,
      limit: config.limit,
      remaining: config.limit - 1,
    };
  }

  existing.count += 1;
  const retryAfterSec = Math.max(
    1,
    Math.ceil((config.windowMs - (now - existing.windowStartMs)) / 1000),
  );

  if (existing.count > config.limit) {
    return {
      allowed: false,
      tier,
      retryAfterSec,
      limit: config.limit,
      remaining: 0,
    };
  }

  return {
    allowed: true,
    tier,
    retryAfterSec: 0,
    limit: config.limit,
    remaining: Math.max(0, config.limit - existing.count),
  };
}

export function cliRateLimitResponse(req: NextRequest): Response | null {
  const pathname = req.nextUrl.pathname;
  if (!pathname.startsWith("/api/cli/v1")) {
    return null;
  }

  const tier = classifyCliRoute(pathname, req.method);
  const identityKey = rateLimitKeyFromRequest(req);
  const result = acquireCliRateSlot(identityKey, tier);

  if (result.allowed) {
    return null;
  }

  return Response.json(
    {
      error: "rate limit exceeded",
      tier: result.tier,
      limit: result.limit,
      retryAfterSec: result.retryAfterSec,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSec),
        "Cache-Control": "private, no-store",
      },
    },
  );
}
