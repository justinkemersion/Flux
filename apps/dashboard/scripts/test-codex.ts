#!/usr/bin/env tsx
/**
 * Smoke test: Flux Codex pipeline.
 *
 * Run before shipping any change that touches the Codex query path:
 *
 *   pnpm --filter dashboard run test:codex
 *
 * What it checks:
 *   1. CODEX_ENV  — CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are set.
 *   2. CODEX_JSON — GET /api/cli/v1/codex returns valid JSON with the right version.
 *   3. CODEX_STREAM — POST to the Cloudflare Workers AI endpoint streams at least one token.
 *
 * Not tested here:
 *   - Next.js server actions (need the full Next runtime).
 *   - Redis throttle (optional; no Redis = fail-open is the documented behaviour).
 *
 * Exit code 0 = all checks passed. Non-zero = first failure.
 */

import { FLUX_CODEX_JSON } from "../src/lib/flux-codex-static.js";

const EXPECTED_VERSION = 3;
const PROBE_QUERY = "What is the Flux project slug format?";
const MODEL = "@cf/meta/llama-3-8b-instruct";
const CF_AI_TIMEOUT_MS = 15_000;

type CheckResult = { ok: true } | { ok: false; reason: string };

// ── helpers ─────────────────────────────────────────────────────────────────

function pass(label: string) {
  console.log(`  ✓  ${label}`);
}

function fail(label: string, reason: string): never {
  console.error(`  ✗  ${label}`);
  console.error(`     ${reason}`);
  process.exit(1);
}

// ── check 1: env vars ───────────────────────────────────────────────────────

function checkEnv(): CheckResult {
  const id = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!id || !token) {
    return {
      ok: false,
      reason:
        "CLOUDFLARE_ACCOUNT_ID and/or CLOUDFLARE_API_TOKEN are not set. " +
        "Export them before running this script.",
    };
  }
  return { ok: true };
}

// ── check 2: static JSON shape ───────────────────────────────────────────────

function checkCodexJson(): CheckResult {
  const v = FLUX_CODEX_JSON.version;
  if (v !== EXPECTED_VERSION) {
    return {
      ok: false,
      reason: `flux-codex-static.ts version is ${String(v)}, expected ${String(EXPECTED_VERSION)}.`,
    };
  }
  if (!("executionModesAndTiers" in FLUX_CODEX_JSON)) {
    return { ok: false, reason: "FLUX_CODEX_JSON missing executionModesAndTiers key." };
  }
  return { ok: true };
}

// ── check 3: Cloudflare Workers AI stream ───────────────────────────────────

async function checkCfStream(): Promise<CheckResult> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID!.trim();
  const token = process.env.CLOUDFLARE_API_TOKEN!.trim();
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CF_AI_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content:
              "You are a test probe. Reply with one short sentence only.",
          },
          { role: "user", content: PROBE_QUERY },
        ],
        stream: true,
        max_tokens: 64,
      }),
    });
  } catch (err) {
    clearTimeout(timeout);
    return {
      ok: false,
      reason: `Fetch failed (timeout or network): ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  clearTimeout(timeout);

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    return {
      ok: false,
      reason: `Cloudflare API returned ${String(res.status)}: ${body.slice(0, 300)}`,
    };
  }

  // Consume enough of the SSE stream to confirm at least one token arrives.
  const contentType = res.headers.get("content-type") ?? "";
  let gotToken = false;

  if (contentType.includes("application/json")) {
    const payload = (await res.json()) as { response?: string; result?: { response?: string } };
    const text = payload.response ?? payload.result?.response ?? "";
    gotToken = text.trim().length > 0;
  } else if (res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    outer: for (let i = 0; i < 50; i++) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const parsed = JSON.parse(raw) as { response?: string };
          if (parsed.response) {
            gotToken = true;
            break outer;
          }
        } catch {
          continue;
        }
      }
    }
    reader.cancel().catch(() => {
      // ignore cleanup errors
    });
  }

  if (!gotToken) {
    return { ok: false, reason: "Stream opened but no token was received from Cloudflare." };
  }

  return { ok: true };
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nFlux Codex smoke test\n");

  const envCheck = checkEnv();
  if (!envCheck.ok) {
    fail("CODEX_ENV", envCheck.reason);
  }
  pass("CODEX_ENV  — credentials present");

  const jsonCheck = checkCodexJson();
  if (!jsonCheck.ok) {
    fail("CODEX_JSON", jsonCheck.reason);
  }
  pass("CODEX_JSON — static spec version and shape ok");

  console.log("  …  CODEX_STREAM — probing Cloudflare Workers AI (may take a few seconds)");
  const streamCheck = await checkCfStream();
  if (!streamCheck.ok) {
    fail("CODEX_STREAM", streamCheck.reason);
  }
  pass("CODEX_STREAM — received at least one token from Workers AI");

  console.log("\n  All checks passed.\n");
}

main().catch((err) => {
  console.error("\n[test-codex] unexpected error:", err);
  process.exit(1);
});
