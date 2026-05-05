import test from "node:test";
import assert from "node:assert/strict";
import {
  FLUX_GATEWAY_DRAINING_MIGRATION_STATUS,
  FLUX_SILENT_MIGRATION_MUTEX_STATUS,
  fluxMigrationStatusIsActiveLease,
} from "./migration-status.ts";

test("fluxMigrationStatusIsActiveLease", () => {
  assert.equal(fluxMigrationStatusIsActiveLease(null), false);
  assert.equal(fluxMigrationStatusIsActiveLease(undefined), false);
  assert.equal(fluxMigrationStatusIsActiveLease(""), false);
  assert.equal(
    fluxMigrationStatusIsActiveLease(FLUX_GATEWAY_DRAINING_MIGRATION_STATUS),
    true,
  );
  assert.equal(
    fluxMigrationStatusIsActiveLease(FLUX_SILENT_MIGRATION_MUTEX_STATUS),
    true,
  );
});
