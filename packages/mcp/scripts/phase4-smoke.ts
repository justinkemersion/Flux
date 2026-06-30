#!/usr/bin/env tsx
/**
 * Phase 4 live smoke: plan → ensureVerified → preflight → apply (+ stale-plan refusal).
 *
 * Usage:
 *   pnpm --filter @flux/mcp exec tsx scripts/phase4-smoke.ts \
 *     --hash <7-char-hex> \
 *     --slug mcp-smoke-fixture \
 *     --yes-apply-smoke-migration
 *
 * Requires explicit --hash and --slug (no defaults). Slug must look like a fixture
 * (contain smoke, fixture, or test) unless --allow-non-fixture-project is passed.
 * Apply steps require --yes-apply-smoke-migration (real ledger row).
 *
 * Operator setup: plans/mcp/fixture-project.md
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getApiClient } from "@flux/cli/api-client";
import { invokeFluxMcpTool } from "../src/server.ts";
import {
  APPLY_ACK_REFUSAL_MESSAGE,
  buildNoopSmokeMigration,
  formatMigrationApplyWarning,
  formatNonFixtureMetadataWarning,
  formatNonFixtureSlugOverrideWarning,
  metadataLooksLikeFixture,
  parsePhase4SmokeArgs,
} from "../src/scripts/phase4-smoke-lib.ts";

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

function makeSmokeWorkspace(input: {
  hash: string;
  slug: string;
}): { root: string; migrationsPath: string; filename: string; sql: string } {
  const root = mkdtempSync(join(tmpdir(), "flux-mcp-phase4-"));
  writeFileSync(
    join(root, "flux.json"),
    JSON.stringify({ slug: input.slug, hash: input.hash }, null, 2),
  );
  const migrationsPath = "migrations";
  const dir = join(root, migrationsPath);
  mkdirSync(dir, { recursive: true });
  const suffix = randomUUID().slice(0, 8);
  const migration = buildNoopSmokeMigration(suffix);
  writeFileSync(join(dir, migration.filename), migration.sql);
  return {
    root,
    migrationsPath,
    filename: migration.filename,
    sql: migration.sql,
  };
}

async function warnIfMetadataNotFixture(
  client: ReturnType<typeof getApiClient>,
  hash: string,
  slug: string,
): Promise<void> {
  try {
    const meta = await client.getProjectMetadata(hash);
    if (
      !metadataLooksLikeFixture({
        slug: meta.slug,
        description: meta.description ?? null,
        brief: meta.brief ?? null,
      })
    ) {
      console.warn(formatNonFixtureMetadataWarning({ slug, hash }));
    }
  } catch {
    // Optional advisory only — slug gate is authoritative.
  }
}

async function main(): Promise<void> {
  const parsed = parsePhase4SmokeArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exit(parsed.exitCode);
  }

  const { hash, slug, applyAcknowledged, slugLooksLikeFixture, allowNonFixtureProject } =
    parsed;
  if (!slugLooksLikeFixture && allowNonFixtureProject) {
    console.warn(formatNonFixtureSlugOverrideWarning(slug));
  }
  console.log(`Phase 4 smoke — ${slug} (${hash})`);
  const client = getApiClient();
  await warnIfMetadataNotFixture(client, hash, slug);
  const ws = makeSmokeWorkspace({ hash, slug });

  try {
    console.log("\n1) flux.migration.plan");
    const plan = await invokeFluxMcpTool(
      "flux.migration.plan",
      {
        hash,
        slug,
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
      { hash, slug, verifyLatestIfFresh: true, reason: "phase4-smoke" },
      client,
    );
    console.log(JSON.stringify(ensure, null, 2));
    assertNoLeaks("backup.ensureVerified", ensure);
    if (!ensure.ok) process.exit(1);

    console.log("\n3) flux.destructive.preflight");
    const preflight = await invokeFluxMcpTool("flux.destructive.preflight", { hash }, client);
    console.log(JSON.stringify(preflight, null, 2));
    assertNoLeaks("destructive.preflight", preflight);
    const preflightData = preflight.data as { allowed?: boolean };
    if (!preflight.ok || preflightData.allowed !== true) process.exit(1);

    if (!applyAcknowledged) {
      console.error(`\n${APPLY_ACK_REFUSAL_MESSAGE}`);
      process.exit(2);
    }

    console.log(
      `\n${formatMigrationApplyWarning({ slug, hash, filename: ws.filename })}`,
    );

    console.log("\n4) flux.migration.apply");
    const apply = await invokeFluxMcpTool(
      "flux.migration.apply",
      {
        hash,
        slug,
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
        hash,
        slug,
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
    const staleData = staleApply.data as { gate?: string; staleReason?: string };
    if (staleData.gate !== "migration_apply_blocked_stale_plan") {
      console.error(`expected migration_apply_blocked_stale_plan, got ${String(staleData.gate)}`);
      process.exit(1);
    }
    if (staleData.staleReason !== "plan_file_checksum_mismatch") {
      console.error(
        `expected staleReason plan_file_checksum_mismatch, got ${String(staleData.staleReason)}`,
      );
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
