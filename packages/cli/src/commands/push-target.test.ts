import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePushTarget } from "./push";

test("resolvePushTarget prefers explicit file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flux-push-target-"));
  try {
    const file = join(dir, "one.sql");
    await writeFile(file, "select 1;");
    const prev = process.cwd();
    process.chdir(dir);
    try {
      const t = await resolvePushTarget("one.sql");
      assert.equal(t.kind, "file");
      assert.ok(t.path.endsWith("one.sql"));
    } finally {
      process.chdir(prev);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolvePushTarget discovers migrations/ by default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flux-push-default-"));
  try {
    const migDir = join(dir, "migrations");
    await mkdir(migDir);
    await writeFile(join(migDir, "001_init.sql"), "-- init");
    const prev = process.cwd();
    process.chdir(dir);
    try {
      const t = await resolvePushTarget();
      assert.equal(t.kind, "directory");
      assert.ok(t.path.endsWith("migrations"));
    } finally {
      process.chdir(prev);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
