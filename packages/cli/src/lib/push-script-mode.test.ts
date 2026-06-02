import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  assertDirectoryPushScriptMode,
  assertForceRequiresRepeatable,
  resolvePushScriptMode,
} from "./push-script-mode.ts";

test("resolvePushScriptMode uses explicit --mode", () => {
  assert.equal(
    resolvePushScriptMode({
      explicitMode: "repeatable",
      resolvedFilePath: "/repo/flux/scripts/x.sql",
    }),
    "repeatable",
  );
});

test("resolvePushScriptMode infers versioned under migrations/", () => {
  const cwd = "/repo";
  assert.equal(
    resolvePushScriptMode({
      resolvedFilePath: resolve(cwd, "migrations/001.sql"),
      cwd,
    }),
    "versioned",
  );
});

test("resolvePushScriptMode infers raw outside migrations/", () => {
  const cwd = "/repo";
  assert.equal(
    resolvePushScriptMode({
      resolvedFilePath: resolve(cwd, "flux-init.sql"),
      cwd,
    }),
    "raw",
  );
});

test("assertDirectoryPushScriptMode rejects raw and repeatable", () => {
  assert.throws(
    () => assertDirectoryPushScriptMode("raw"),
    /--mode raw applies to single SQL files only/,
  );
  assert.throws(
    () => assertDirectoryPushScriptMode("repeatable"),
    /--mode repeatable applies to single SQL files only/,
  );
  assert.doesNotThrow(() => assertDirectoryPushScriptMode("versioned"));
});

test("assertForceRequiresRepeatable", () => {
  assert.throws(
    () => assertForceRequiresRepeatable(true, "versioned"),
    /--force requires --mode repeatable/,
  );
  assert.doesNotThrow(() => assertForceRequiresRepeatable(true, "repeatable"));
});
