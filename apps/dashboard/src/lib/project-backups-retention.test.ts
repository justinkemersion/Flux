import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm, access, mkdtemp } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { S3OffsiteClient } from "@flux/core/offsite-storage";
import type { BackupStorage } from "./backup-storage.js";
import {
  createR2BackupStorageForTests,
  getBackupStorage,
  resetBackupStorageForTests,
} from "./backup-storage.js";
import {
  purgeBackupArtifacts,
  sweepProjectBackupRetention,
  type BackupRow,
} from "./project-backups.js";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const OFFSITE_PREFIX = "prod/flux/v1/abc1234";

function fakeRow(
  overrides: Partial<BackupRow> & Pick<BackupRow, "id">,
): BackupRow {
  const now = Date.now();
  return {
    projectId: PROJECT_ID,
    kind: "project_db",
    format: "pg_custom",
    localPath: `/tmp/${overrides.id}.dump`,
    sizeBytes: 1,
    checksumSha256: "a".repeat(64),
    status: "complete",
    completedAt: new Date(now),
    error: null,
    offsiteStatus: "complete",
    offsiteProvider: "r2",
    offsiteBucket: "vsl-base-flux-backups",
    offsiteKey: `${OFFSITE_PREFIX}/${overrides.id}.dump`,
    offsiteCompletedAt: new Date(now),
    offsiteSizeBytes: 1,
    offsiteEtag: "etag",
    offsiteContentSha256: "a".repeat(64),
    offsiteError: null,
    artifactValidationStatus: "artifact_valid",
    artifactValidationAt: new Date(now),
    artifactValidationError: null,
    restoreVerificationStatus: "restore_verified",
    restoreVerificationAt: new Date(now),
    restoreVerificationError: null,
    createdAt: new Date(now),
    ...overrides,
  };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

function retentionRows(oldId: string): BackupRow[] {
  return [
    fakeRow({ id: "keep-1", restoreVerificationAt: daysAgo(1), createdAt: daysAgo(1) }),
    fakeRow({ id: "keep-2", restoreVerificationAt: daysAgo(2), createdAt: daysAgo(2) }),
    fakeRow({ id: "keep-3", restoreVerificationAt: daysAgo(3), createdAt: daysAgo(3) }),
    fakeRow({ id: "keep-4", restoreVerificationAt: daysAgo(4), createdAt: daysAgo(4) }),
    fakeRow({
      id: oldId,
      restoreVerificationAt: daysAgo(50),
      createdAt: daysAgo(50),
    }),
  ];
}

function mockStorage(input: {
  localRoot: string;
  deleteOffsite: (key: string) => Promise<void>;
  usesR2?: boolean;
}): BackupStorage {
  return {
    ensureRoots: async () => undefined,
    absoluteLocalRoot: () => input.localRoot,
    localPathForBackup: (projectId, backupId) =>
      path.join(input.localRoot, projectId, `${backupId}.dump`),
    uploadOffsite: async () => {
      throw new Error("uploadOffsite not used in retention tests");
    },
    deleteOffsite: input.deleteOffsite,
    usesR2Offsite: () => input.usesR2 ?? true,
  };
}

async function withEnv(
  env: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    prev[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetBackupStorageForTests();
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetBackupStorageForTests();
  }
}

test("retention sweep deletes R2 object with the stored offsite key", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "flux-retention-r2-"));
  const deletedKeys: string[] = [];
  const deletedIds: string[] = [];
  const oldId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const s3 = new S3OffsiteClient(
    {
      enabled: true,
      strict: false,
      bucket: "test-bucket",
      prefix: "prod",
      endpoint: "https://example.r2.cloudflarestorage.com",
      region: "auto",
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
    },
    {
      send: async (cmd) => {
        const key = (cmd as { input?: { Key?: string } }).input?.Key;
        if (key) deletedKeys.push(key);
        return {};
      },
    },
  );
  const storage = createR2BackupStorageForTests(dir, s3);
  await mkdir(path.join(dir, PROJECT_ID), { recursive: true });
  await writeFile(storage.localPathForBackup(PROJECT_ID, oldId), "dump");

  const deleted = await sweepProjectBackupRetention(
    {
      id: PROJECT_ID,
      backupIntervalDays: 7,
      backupRetentionCount: 4,
      backupRetentionDays: 30,
    },
    {
      storage,
      listRows: async () => retentionRows(oldId),
      deleteCatalogRow: async (id) => {
        deletedIds.push(id);
      },
    },
  );

  assert.equal(deleted, 1);
  assert.deepEqual(deletedIds, [oldId]);
  assert.deepEqual(deletedKeys, [`${OFFSITE_PREFIX}/${oldId}.dump`]);
  await rm(dir, { recursive: true, force: true });
});

test("retention sweep continues when remote object is already missing", async () => {
  const dir = path.join(tmpdir(), `flux-retention-404-${Date.now()}`);
  const deletedIds: string[] = [];
  const oldId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const storage = mockStorage({
    localRoot: dir,
    usesR2: true,
    deleteOffsite: async () => {
      const err = new Error("The specified key does not exist.");
      err.name = "NoSuchKey";
      (err as { $metadata?: { httpStatusCode?: number } }).$metadata = {
        httpStatusCode: 404,
      };
      throw err;
    },
  });

  const deleted = await sweepProjectBackupRetention(
    {
      id: PROJECT_ID,
      backupIntervalDays: 7,
      backupRetentionCount: 4,
      backupRetentionDays: 30,
    },
    {
      storage,
      listRows: async () => retentionRows(oldId),
      deleteCatalogRow: async (id) => {
        deletedIds.push(id);
      },
    },
  );

  assert.equal(deleted, 1);
  assert.deepEqual(deletedIds, [oldId]);
});

test("retention sweep continues when offsite delete fails for other reasons", async () => {
  const deletedIds: string[] = [];
  const oldId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  const storage = mockStorage({
    localRoot: path.join(tmpdir(), "flux-retention-denied"),
    usesR2: true,
    deleteOffsite: async () => {
      throw new Error("AccessDenied: cannot delete object");
    },
  });

  const deleted = await sweepProjectBackupRetention(
    {
      id: PROJECT_ID,
      backupIntervalDays: 7,
      backupRetentionCount: 4,
      backupRetentionDays: 30,
    },
    {
      storage,
      listRows: async () => retentionRows(oldId),
      deleteCatalogRow: async (id) => {
        deletedIds.push(id);
      },
    },
  );

  assert.equal(deleted, 1);
  assert.deepEqual(deletedIds, [oldId]);
});

test("local-only retention does not call offsite delete and still drops the row", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "flux-retention-local-"));
  const deletedKeys: string[] = [];
  const deletedIds: string[] = [];
  const oldId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const storage = mockStorage({
    localRoot: dir,
    usesR2: false,
    deleteOffsite: async (key) => {
      deletedKeys.push(key);
    },
  });
  await mkdir(path.join(dir, PROJECT_ID), { recursive: true });
  const localPath = storage.localPathForBackup(PROJECT_ID, oldId);
  await writeFile(localPath, "dump");

  const rows = retentionRows(oldId).map((row) =>
    row.id === oldId
      ? {
          ...row,
          offsiteKey: null,
          offsiteStatus: "pending",
          offsiteProvider: null,
          offsiteBucket: null,
        }
      : { ...row, offsiteKey: null, offsiteStatus: "pending" },
  );

  const deleted = await sweepProjectBackupRetention(
    {
      id: PROJECT_ID,
      backupIntervalDays: 7,
      backupRetentionCount: 4,
      backupRetentionDays: 30,
    },
    {
      storage,
      listRows: async () => rows,
      deleteCatalogRow: async (id) => {
        deletedIds.push(id);
      },
    },
  );

  assert.equal(deleted, 1);
  assert.deepEqual(deletedIds, [oldId]);
  assert.deepEqual(deletedKeys, []);
  await assert.rejects(() => access(localPath, constants.F_OK), { code: "ENOENT" });
  await rm(dir, { recursive: true, force: true });
});

test("filesystem offsite mode deletes the replica file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "flux-retention-fs-"));
  const localRoot = path.join(dir, "local");
  const offsiteRoot = path.join(dir, "offsite");
  await withEnv(
    {
      FLUX_R2_BACKUPS_ENABLED: "false",
      FLUX_BACKUPS_LOCAL_DIR: localRoot,
      FLUX_BACKUPS_OFFSITE_DIR: offsiteRoot,
    },
    async () => {
      const storage = getBackupStorage();
      assert.equal(storage.usesR2Offsite(), false);
      const key = `${PROJECT_ID}/fs-backup.dump`;
      await mkdir(path.join(localRoot, PROJECT_ID), { recursive: true });
      const localPath = storage.localPathForBackup(PROJECT_ID, "fs-backup");
      await writeFile(localPath, "dump-bytes");
      await storage.uploadOffsite(localPath, key);
      await purgeBackupArtifacts(
        { id: "fs-backup", projectId: PROJECT_ID, offsiteKey: key },
        storage,
      );
      await assert.rejects(() => access(localPath, constants.F_OK), {
        code: "ENOENT",
      });
      await assert.rejects(
        () => access(path.join(offsiteRoot, key), constants.F_OK),
        { code: "ENOENT" },
      );
    },
  );
  await rm(dir, { recursive: true, force: true });
});
