import assert from "node:assert/strict";
import test from "node:test";
import { destructiveCutoverAllowed } from "./system-db-cutovers.js";

test("destructiveCutoverAllowed is false by default", () => {
  const prev = process.env.FLUX_SYSTEM_DB_ALLOW_DESTRUCTIVE_CUTOVER;
  delete process.env.FLUX_SYSTEM_DB_ALLOW_DESTRUCTIVE_CUTOVER;
  try {
    assert.equal(destructiveCutoverAllowed(), false);
  } finally {
    if (prev === undefined) delete process.env.FLUX_SYSTEM_DB_ALLOW_DESTRUCTIVE_CUTOVER;
    else process.env.FLUX_SYSTEM_DB_ALLOW_DESTRUCTIVE_CUTOVER = prev;
  }
});

test("destructiveCutoverAllowed accepts 1/true/yes", () => {
  const prev = process.env.FLUX_SYSTEM_DB_ALLOW_DESTRUCTIVE_CUTOVER;
  for (const v of ["1", "true", "YES"]) {
    process.env.FLUX_SYSTEM_DB_ALLOW_DESTRUCTIVE_CUTOVER = v;
    assert.equal(destructiveCutoverAllowed(), true, v);
  }
  if (prev === undefined) delete process.env.FLUX_SYSTEM_DB_ALLOW_DESTRUCTIVE_CUTOVER;
  else process.env.FLUX_SYSTEM_DB_ALLOW_DESTRUCTIVE_CUTOVER = prev;
});
