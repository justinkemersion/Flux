#!/usr/bin/env tsx
/**
 * Phase 3B live smoke against hosted Flux (stdio-free; uses invokeFluxMcpTool).
 *
 * Usage:
 *   pnpm --filter @flux/mcp exec tsx scripts/phase3b-smoke.ts [hash] [slug]
 *   # default: bloom-atelier 61d9dff
 */

import { getApiClient } from "@flux/cli/api-client";
import { invokeFluxMcpTool } from "../src/server.ts";

const HASH = (process.argv[2] ?? "61d9dff").trim().toLowerCase();
const SLUG = (process.argv[3] ?? "bloom-atelier").trim();

function assertNoLeaks(label: string, payload: unknown): void {
  const text = JSON.stringify(payload);
  const bad = [
    /\/srv\//,
    /primaryArtifact/,
    /offsiteKey/,
    /offsiteBucket/,
    /backupVolumeAbsoluteRoot/,
    /flx_live_/,
    /eyJ[A-Za-z0-9_-]{10,}\./,
    /postgres:\/\//,
    /https?:\/\/[^\s"']+\?[^"']*signature/i,
  ];
  for (const re of bad) {
    if (re.test(text)) {
      throw new Error(`${label}: output may leak sensitive data (matched ${String(re)})`);
    }
  }
}

async function main(): Promise<void> {
  console.log(`Phase 3B smoke — ${SLUG} (${HASH})`);
  const client = getApiClient();

  console.log("\n1) flux.backup.list");
  const list = await invokeFluxMcpTool("flux.backup.list", { hash: HASH }, client);
  console.log(JSON.stringify({ ok: list.ok, summary: list.summary, backupCount: (list.data as { backups?: unknown[] })?.backups?.length }, null, 2));
  assertNoLeaks("backup.list", list);
  if (!list.ok) process.exit(1);

  console.log("\n2) flux.backup.ensureVerified");
  const ensure = await invokeFluxMcpTool(
    "flux.backup.ensureVerified",
    { hash: HASH, slug: SLUG, verifyLatestIfFresh: true, reason: "phase3b-smoke" },
    client,
  );
  console.log(JSON.stringify(ensure, null, 2));
  assertNoLeaks("backup.ensureVerified", ensure);
  if (!ensure.ok) {
    console.error("ensureVerified failed");
    process.exit(1);
  }

  const ensureData = ensure.data as {
    created?: boolean;
    verified?: boolean;
    trustTier?: string;
    intentId?: string;
  };
  const intentId = ensureData.intentId;
  if (!intentId) {
    console.error("missing intentId in ensureVerified data");
    process.exit(1);
  }

  console.log("\n3) flux.destructive.preflight");
  const preflight = await invokeFluxMcpTool("flux.destructive.preflight", { hash: HASH }, client);
  console.log(JSON.stringify(preflight, null, 2));
  assertNoLeaks("destructive.preflight", preflight);
  if (!preflight.ok) process.exit(1);

  const preflightData = preflight.data as { allowed?: boolean; tier?: string };
  if (!preflightData.allowed || preflightData.tier !== "restorable") {
    console.error("preflight expected allowed + restorable");
    process.exit(1);
  }

  console.log("\n4) intent GET (terminal state)");
  const intent = await client.getMcpIntent(intentId);
  console.log(JSON.stringify({ intentId: intent.intentId, status: intent.status, resultStatus: intent.resultStatus, tool: intent.tool, intentClass: intent.intentClass }, null, 2));
  if (intent.status !== "completed") {
    console.error(`expected intent status completed, got ${intent.status}`);
    process.exit(1);
  }

  console.log("\n--- smoke summary ---");
  console.log(
    JSON.stringify(
      {
        project: SLUG,
        hash: HASH,
        ensureVerified: {
          created: ensureData.created,
          verified: ensureData.verified,
          trustTier: ensureData.trustTier,
        },
        preflight: { allowed: preflightData.allowed, tier: preflightData.tier },
        intent: { id: intentId, status: intent.status },
        audit: "persisted via invokeFluxMcpTool finalizeToolAudit (stderr + POST /audit)",
      },
      null,
      2,
    ),
  );

  if (ensureData.created !== false || ensureData.verified !== true || ensureData.trustTier !== "restorable") {
    console.warn(
      "Note: early-return path expected created:false verified:true trustTier:restorable — got different values (create+verify path may have run).",
    );
  } else {
    console.log("Early-return path confirmed (no new backup created).");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
