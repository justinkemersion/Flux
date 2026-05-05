import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { MigrationPlan } from "./types.ts";

export async function pgDumpTenantSchemaToFile(input: {
  databaseUrl: string;
  plan: MigrationPlan;
  outPath?: string;
}): Promise<string> {
  const outPath =
    input.outPath ??
    join(
      tmpdir(),
      `flux-migrate-${input.plan.projectId}-${String(Date.now())}.sql`,
    );
  const schema = input.plan.tenantSchema;
  const args = [
    input.databaseUrl,
    "--schema",
    schema,
    "--no-owner",
    "--no-acl",
    "--format",
    "plain",
    "-f",
    outPath,
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn("pg_dump", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    child.stderr?.on("data", (c: Buffer) => {
      err += c.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump failed (${String(code)}): ${err || "no stderr"}`));
    });
  });
  return outPath;
}
