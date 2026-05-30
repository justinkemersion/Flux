import test from "node:test";
import assert from "node:assert/strict";
import {
  DestructiveBackupBlockedError,
  parseSkipBackupCheckParam,
} from "./destructive-backup-gate.ts";

test("parseSkipBackupCheckParam accepts true/1/yes", () => {
  assert.equal(parseSkipBackupCheckParam("true"), true);
  assert.equal(parseSkipBackupCheckParam("1"), true);
  assert.equal(parseSkipBackupCheckParam("yes"), true);
  assert.equal(parseSkipBackupCheckParam("false"), false);
  assert.equal(parseSkipBackupCheckParam(null), false);
});

test("DestructiveBackupBlockedError is identifiable", () => {
  const err = new DestructiveBackupBlockedError("blocked");
  assert.equal(err.name, "DestructiveBackupBlockedError");
  assert.match(err.message, /blocked/);
});
