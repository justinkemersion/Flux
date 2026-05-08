import test from "node:test";
import assert from "node:assert/strict";
import {
  pgDumpV2TenantExportArgvTail,
} from "./tenant-backup-stream.ts";

test("pgDumpV2TenantExportArgvTail matches pg_dump custom tenant schema flags", () => {
  const tail = pgDumpV2TenantExportArgvTail("t_a1b2c3d4e5f6_api");
  assert.deepEqual(tail, [
    "--schema",
    "t_a1b2c3d4e5f6_api",
    "--no-owner",
    "--no-acl",
    "--format",
    "custom",
  ]);
});
