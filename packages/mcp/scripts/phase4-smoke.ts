#!/usr/bin/env tsx
/**
 * Phase 4 live smoke: plan → ensureVerified → preflight → apply (+ stale-plan refusal).
 *
 * Usage:
 *   pnpm --filter @flux/mcp exec tsx scripts/phase4-smoke.ts [hash] [slug]
 *   # default: bloom-atelier 61d9dff
 *
 * Creates a disposable migration under /tmp and applies it once, then verifies stale-plan refusal.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getApiClient } from "@flux/cli/api-client";
import { invokeFluxMcpTool } from "../src/server.ts";

const HASH = (process.argv[2] ?? "61d9dff").trim().toLowerCase();
const SLUG = (process.argv[3] ?? "bloom-atelier").trim();

function assertNoLeaks(label: string, payload: unknown): void {
  const text = JSON.stringify(payload);
  const bad = [
    /\/srv\//,
    /\/tmp\/flux-mcp-apply/,
    /primaryArtifact/,
    /offsiteKey/,
    /offsiteBucket/,
    /CREATE TABLE/,
    /ALTER TABLE/,
    /DROP TABLE/,
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

function makeSmokeWorkspace(): { root: string; migrationsPath: string; filename: string } {
  const root = mkdtempSync(join(tmpdir(), "flux-mcp-phase4-"));
  writeFileSync(
    join(root, "flux.json"),
    JSON.stringify({ slug: SLUG, hash: HASH }, null, 2),
  );
  const migrationsPath = "migrations";
  const dir = join(root, migrationsPath);
  mkdirSync(dir, { recursive: true });
  const suffix = randomUUID().slice(0, 8);
  const filename = `9999_mcp_smoke_${suffix}.sql`;
  writeFileSync(
    join(dir, filename),
    `-- flux mcp phase4 smoke ${suffix}\nSELECT version();\n`,
  );
  return { root, migrationsPath, filename };
}

async function main(): Promise<void> {
  console.log(`Phase 4 smoke — ${SLUG} (${HASH})`);
  const client = getApiClient();
  const ws = makeSmokeWorkspace();

  try {
    console.log("\n1) flux.migration.plan");
    const plan = await invokeFluxMcpTool(
      "flux.migration.plan",
      {
        hash: HASH,
        slug: SLUG,
        workspaceRoot: ws.root,
        migrationsPath: ws.migrationsPath,
      },
      client,
    );
    console.log(JSON.stringify(plan, null, 2));
    assertNoLeaks("migration.plan", plan);
    if (!plan.ok) {
      console.error("plan failed");
      process.exit(1);
    }
    const planData = plan.data as {
      planId: string;
      planHash: string;
      counts: { apply: number };
    };
    if (planData.counts.apply < 1) {
      console.error("expected at least one migration to apply");
      process.exit(1);
    }

    console.log("\n2) flux.backup.ensureVerified");
    const ensure = await invokeFluxMcpTool(
      "flux.backup.ensureVerified",
      { hash: HASH, slug: SLUG, verifyLatestIfFresh: true, reason: "phase4-smoke" },
      client,
    );
    console.log(JSON.stringify(ensure, null, 2));
    assertNoLeaks("backup.ensureVerified", ensure);
    if (!ensure.ok) process.exit(1);

    console.log("\n3) flux.destructive.preflight");
    const preflight = await invokeFluxMcpTool("flux.destructive.preflight", { hash: HASH }, client);
    console.log(JSON.stringify(preflight, null, 2));
    assertNoLeaks("destructive.preflight", preflight);
    const preflightData = preflight.data as { allowed?: boolean };
    if (!preflight.ok || preflightData.allowed !== true) process.exit(1);

    console.log("\n4) flux.migration.apply");
    const apply = await invokeFluxMcpTool(
      "flux.migration.apply",
      {
        hash: HASH,
        slug: SLUG,
        planId: planData.planId,
        planHash: planData.planHash,
        workspaceRoot: ws.root,
        migrationsPath: ws.migrationsPath,
        reason: "phase4-smoke apply",
      },
      client,
    );
    console.log(JSON.stringify(apply, null, 2));
    assertNoLeaks("migration.apply", apply);
    if (!apply.ok) {
      console.error("apply failed");
      process.exit(1);
    }
    const applyData = apply.data as {
      appliedCount: number;
      appliedFiles: string[];
      intentId?: string;
      gate?: string;
    };
    if (!applyData.intentId || applyData.gate !== "migration_apply_allowed") {
      console.error("unexpected apply metadata");
      process.exit(1);
    }
    console.log(`applied=${String(applyData.appliedCount)} files=${applyData.appliedFiles.join(",")}`);

    console.log("\n5) stale-plan refusal (modify local file after plan)");
    const migrationFile = join(ws.root, ws.migrationsPath, ws.filename);
    const original = readFileSync(migrationFile, "utf8");
    writeFileSync(migrationFile, `${original}\n-- drift\n`);
    const staleApply = await invokeFluxMcpTool(
      "flux.migration.apply",
      {
        hash: HASH,
        slug: SLUG,
        planId: planData.planId,
        planHash: planData.planHash,
        workspaceRoot: ws.root,
        migrationsPath: ws.migrationsPath,
      },
      client,
    );
    console.log(JSON.stringify(staleApply, null, 2));
    assertNoLeaks("migration.apply stale", staleApply);
    if (staleApply.ok) {
      console.error("expected stale apply to be refused");
      process.exit(1);
    }
    const staleData = staleApply.data as { gate?: string };
    if (staleData.gate !== "migration_apply_blocked_stale_plan") {
      console.error(`expected migration_apply_blocked_stale_plan, got ${String(staleData.gate)}`);
      process.exit(1);
    }

    console.log("\nPhase 4 smoke passed.");
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
