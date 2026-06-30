#!/usr/bin/env tsx
/**
 * Hosted MCP smoke runner (invoked by bin/mcp-smoke.sh --hosted).
 */

import {
  buildOfflineSignoff,
  formatSignoffBlock,
  allSignoffsPassed,
  hostedEnvPresent,
  offlineContractChecks,
  runHostedSmokeProbes,
} from "./mcp-smoke-lib.ts";

async function main(): Promise<void> {
  for (const line of offlineContractChecks()) {
    console.log(line);
  }

  const signoffs = buildOfflineSignoff();

  if (!hostedEnvPresent()) {
    console.error("FAIL: FLUX_MCP_TOKEN and FLUX_MCP_SMOKE_HASH required for hosted smoke");
    process.exit(1);
  }

  const hosted = await runHostedSmokeProbes();
  signoffs.push(...hosted);

  console.log("");
  console.log(formatSignoffBlock(signoffs));
  console.log("");

  if (!allSignoffsPassed(signoffs)) {
    const failed = signoffs.filter((row) => !row.pass);
    for (const row of failed) {
      console.error(`FAIL: ${row.label}${row.detail ? ` — ${row.detail}` : ""}`);
    }
    process.exit(1);
  }

  console.log("MCP v0.1 — Agent Contract & Context: GREEN");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
