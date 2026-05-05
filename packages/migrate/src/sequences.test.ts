import test from "node:test";
import assert from "node:assert/strict";
import { assertSequenceSnapshotsMatch } from "./sequences.ts";

test("assertSequenceSnapshotsMatch accepts identical maps", () => {
  const a = new Map([
    ["s1", "1"],
    ["s2", "42"],
  ]);
  assertSequenceSnapshotsMatch(a, new Map(a), "t_abcd_api");
});

test("assertSequenceSnapshotsMatch throws on last_value drift", () => {
  const src = new Map([["s1", "10"]]);
  const tgt = new Map([["s1", "9"]]);
  assert.throws(
    () => assertSequenceSnapshotsMatch(src, tgt, "sch"),
    /last_value mismatch/,
  );
});

test("assertSequenceSnapshotsMatch throws on missing sequence in target", () => {
  const src = new Map([["s1", "1"]]);
  const tgt = new Map<string, string>();
  assert.throws(
    () => assertSequenceSnapshotsMatch(src, tgt, "sch"),
    /not in target/,
  );
});
