import test from "node:test";
import assert from "node:assert/strict";
import {
  FLUX_GATEWAY_DRAINING_MIGRATION_STATUS,
  FLUX_SILENT_MIGRATION_MUTEX_STATUS,
} from "@flux/core";
import type { SystemDb } from "@/src/lib/db";
import { claimProjectMigrationLease } from "./v2-to-v1-migrate";

const baseRow = {
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  name: "Demo",
  slug: "demo",
  hash: "abc1234",
  userId: "user-1",
  createdAt: new Date(),
  lastAccessedAt: new Date(),
  lastHeartbeatAt: null as Date | null,
  healthStatus: null as string | null,
  mode: "v2_shared" as const,
  jwtSecret: "secret",
  migrationStatus: null as string | null,
  apiSchemaName: null as string | null,
  apiSchemaStrategy: null as string | null,
};

function makeLeaseMockDb(state: { migrationStatus: string | null }): SystemDb {
  const rowSlice = () => [{ ...baseRow, migrationStatus: state.migrationStatus }];
  return {
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({
              for: (_k: "update") => ({
                limit: async () => rowSlice(),
              }),
              limit: async () => rowSlice(),
            }),
          }),
        }),
        update: () => ({
          set: (v: { migrationStatus: string }) => {
            state.migrationStatus = v.migrationStatus;
            return { where: async () => undefined };
          },
        }),
      };
      return fn(tx);
    },
  } as SystemDb;
}

test("claimProjectMigrationLease refuses double-start (lockWrites)", async () => {
  const state = { migrationStatus: null as string | null };
  const db = makeLeaseMockDb(state);

  const first = await claimProjectMigrationLease(
    db,
    "user-1",
    "demo",
    "abc1234",
    true,
  );
  assert.equal(first.ok, true);
  assert.equal(state.migrationStatus, FLUX_GATEWAY_DRAINING_MIGRATION_STATUS);

  const second = await claimProjectMigrationLease(
    db,
    "user-1",
    "demo",
    "abc1234",
    true,
  );
  assert.equal(second.ok, false);
  if (second.ok === false) assert.equal(second.reason, "busy");
});

test("claimProjectMigrationLease uses silent mutex when not lockWrites", async () => {
  const state = { migrationStatus: null as string | null };
  const db = makeLeaseMockDb(state);

  await claimProjectMigrationLease(db, "user-1", "demo", "abc1234", false);
  assert.equal(state.migrationStatus, FLUX_SILENT_MIGRATION_MUTEX_STATUS);
});
