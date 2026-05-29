import test from "node:test";
import assert from "node:assert/strict";
import { parseSkipBackupCheckParam } from "./destructive-backup-gate.ts";

test("parseSkipBackupCheckParam accepts true/1/yes", () => {
  assert.equal(parseSkipBackupCheckParam("true"), true);
  assert.equal(parseSkipBackupCheckParam("1"), true);
  assert.equal(parseSkipBackupCheckParam("yes"), true);
  assert.equal(parseSkipBackupCheckParam("false"), false);
  assert.equal(parseSkipBackupCheckParam(null), false);
});
