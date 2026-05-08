/**
 * Stream `pg_dump -Fc` for a single tenant schema on the v2 shared Postgres cluster.
 */
import { spawn } from "node:child_process";
import { PassThrough, type Readable } from "node:stream";

import { defaultTenantApiSchemaFromProjectId } from "@flux/core";
import { assertPgDumpOnPath, assertSharedPostgresUrlConfigured } from "@flux/migrate";

/** Resolved pg_dump argv tail after the connection URL (for tests). */
export function pgDumpV2TenantExportArgvTail(schemaName: string): string[] {
  return [
    "--schema",
    schemaName,
    "--no-owner",
    "--no-acl",
    "--format",
    "custom",
  ];
}

/**
 * Streams PostgreSQL custom-format dump (`pg_dump -Fc`) for `t_<shortId>_api` only.
 */
export async function getV2SharedTenantBackupStream(input: {
  projectId: string;
}): Promise<Readable> {
  assertSharedPostgresUrlConfigured();
  assertPgDumpOnPath();
  const databaseUrl = process.env.FLUX_SHARED_POSTGRES_URL!.trim();
  const schemaName = defaultTenantApiSchemaFromProjectId(input.projectId);
  const args = [databaseUrl, ...pgDumpV2TenantExportArgvTail(schemaName)];

  const child = spawn("pg_dump", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdout = new PassThrough();
  const stderrChunks: Buffer[] = [];

  child.stderr?.on("data", (c: Buffer | string | Uint8Array) => {
    stderrChunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  });

  child.once("error", (err: Error) => {
    stdout.destroy(err);
  });

  child.once("close", (code) => {
    if (code === 0) return;
    const stderrText = Buffer.concat(stderrChunks).toString("utf8").trim();
    stdout.destroy(
      new Error(
        stderrText.length > 0
          ? `pg_dump -Fc failed (${String(code)}): ${stderrText.slice(0, 2000)}`
          : `pg_dump -Fc failed (exit ${String(code)}).`,
      ),
    );
  });

  if (!child.stdout) {
    throw new Error("pg_dump: missing stdout pipe.");
  }

  child.stdout.pipe(stdout);
  return stdout;
}
