import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationChecksum } from "@flux/core/sql-migrations";
import { cmdPush, type CmdPushOptions } from "./push.ts";

const SQL = "select 1;\n";

const dryRunOptions: CmdPushOptions = {
  supabaseCompat: false,
  noSanitize: false,
  disableApiRls: false,
  pushMode: "dry-run",
  hash: "abc1234",
  projectMetadata: { mode: "v2_shared" },
};

async function capturePush(
  options: CmdPushOptions,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "flux-push-preview-"));
  const prev = process.cwd();
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    await mkdir(join(dir, "sql", "migrations"), { recursive: true });
    await writeFile(join(dir, "sql", "migrations", "0018_x.sql"), SQL);
    process.chdir(dir);
    await cmdPush("sql/migrations/0018_x.sql", "demo", options, null);
  } finally {
    console.log = orig;
    process.chdir(prev);
    await rm(dir, { recursive: true, force: true });
  }
  return lines.join("\n");
}

test("sql/migrations dry-run with no --mode reports versioned", async () => {
  const text = await capturePush(dryRunOptions);
  const prefix = migrationChecksum(SQL).slice(0, 12);
  assert.match(
    text,
    new RegExp(
      `Versioned migration: on apply, recorded in flux\\.flux_migrations as version 0018_x\\.sql \\(checksum ${prefix}\\)`,
    ),
  );
  assert.match(text, /This dry run did not check the ledger/);
  assert.match(text, /Dry run OK\. Nothing applied\./);
  assert.doesNotMatch(text, /raw SQL, not recorded/);
});

test("sql/migrations dry-run --mode versioned reports versioned", async () => {
  const text = await capturePush({
    ...dryRunOptions,
    explicitScriptMode: "versioned",
  });
  const prefix = migrationChecksum(SQL).slice(0, 12);
  assert.match(
    text,
    new RegExp(
      `Versioned migration: on apply, recorded in flux\\.flux_migrations as version 0018_x\\.sql \\(checksum ${prefix}\\)`,
    ),
  );
  assert.match(
    text,
    /Skipped if already applied with the same checksum; fails on a checksum conflict/,
  );
  assert.doesNotMatch(text, /raw SQL, not recorded/);
});
