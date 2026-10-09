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
  sweepRetentionBatch,
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

test("retention removes failed and restore_failed files once a newer verified backup exists", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "flux-retention-failed-"));
  const deletedKeys: string[] = [];
  const deletedIds: string[] = [];
  const oldFailed = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
  const oldRestoreFailed = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
  const newerFailed = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";
  const storage = mockStorage({
    localRoot: dir,
    usesR2: true,
    deleteOffsite: async (key) => {
      deletedKeys.push(key);
    },
  });
  await mkdir(path.join(dir, PROJECT_ID), { recursive: true });
  for (const id of [oldFailed, oldRestoreFailed, newerFailed]) {
    await writeFile(storage.localPathForBackup(PROJECT_ID, id), "dump");
  }
  const verified = fakeRow({
    id: "verified-new",
    createdAt: daysAgo(1),
    restoreVerificationAt: daysAgo(1),
    offsiteKey: null,
    offsiteStatus: "pending",
  });
  const rows = [
    fakeRow({
      id: oldFailed,
      status: "failed",
      artifactValidationStatus: "skipped",
      restoreVerificationStatus: "skipped",
      createdAt: daysAgo(20),
      offsiteKey: `${OFFSITE_PREFIX}/${oldFailed}.dump`,
      offsiteStatus: "failed",
    }),
    fakeRow({
      id: oldRestoreFailed,
      status: "complete",
      restoreVerificationStatus: "restore_failed",
      createdAt: daysAgo(40),
      offsiteKey: null,
      offsiteStatus: "pending",
    }),
    fakeRow({
      id: newerFailed,
      status: "failed",
      artifactValidationStatus: "skipped",
      restoreVerificationStatus: "skipped",
      createdAt: daysAgo(0),
      offsiteKey: `${OFFSITE_PREFIX}/${newerFailed}.dump`,
      offsiteStatus: "failed",
    }),
    verified,
  ];

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

  assert.equal(deleted, 2);
  assert.deepEqual(deletedIds.sort(), [oldFailed, oldRestoreFailed].sort());
  assert.deepEqual(deletedKeys, [`${OFFSITE_PREFIX}/${oldFailed}.dump`]);
  await assert.rejects(
    () => access(storage.localPathForBackup(PROJECT_ID, oldFailed), constants.F_OK),
    { code: "ENOENT" },
  );
  await assert.rejects(
    () => access(storage.localPathForBackup(PROJECT_ID, oldRestoreFailed), constants.F_OK),
    { code: "ENOENT" },
  );
  await access(storage.localPathForBackup(PROJECT_ID, newerFailed), constants.F_OK);
  await rm(dir, { recursive: true, force: true });
});

test("hourly retention sweep cleans a project past the first 10", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "flux-retention-batch-"));
  const deletedIds: string[] = [];
  const swept: string[] = [];
  const foundryId = "00000000-0000-4000-8000-000000000010";
  const holdId = "00000000-0000-4000-8000-000000000011";
  const oldFailed = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
  const oldRestoreFailed = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2";
  const newestFailed = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3";
  const heldFailed = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4";
  const storage = mockStorage({
    localRoot: dir,
    usesR2: true,
    deleteOffsite: async () => undefined,
  });

  function catalogProject(
    index: number,
    slug: string,
    userId = "user-1",
  ) {
    return {
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      slug,
      userId,
      backupIntervalDays: 7,
      backupRetentionCount: 4,
      backupRetentionDays: 30,
    };
  }

  const early = Array.from({ length: 10 }, (_, index) =>
    catalogProject(index, `early-${String(index)}`),
  );
  const foundry = catalogProject(10, "flux-app-foundry");
  const hold = catalogProject(11, "late-hold");
  const excluded = catalogProject(99, "flux-system", "system");
  assert.equal(foundry.id, foundryId);
  assert.equal(hold.id, holdId);

  const foundryRows = [
    fakeRow({
      id: oldFailed,
      projectId: foundryId,
      status: "failed",
      artifactValidationStatus: "skipped",
      restoreVerificationStatus: "skipped",
      createdAt: daysAgo(20),
      offsiteKey: null,
      offsiteStatus: "failed",
    }),
    fakeRow({
      id: oldRestoreFailed,
      projectId: foundryId,
      status: "complete",
      restoreVerificationStatus: "restore_failed",
      createdAt: daysAgo(40),
      offsiteKey: null,
      offsiteStatus: "pending",
    }),
    fakeRow({
      id: newestFailed,
      projectId: foundryId,
      status: "failed",
      artifactValidationStatus: "skipped",
      restoreVerificationStatus: "skipped",
      createdAt: daysAgo(0),
      offsiteKey: null,
      offsiteStatus: "failed",
    }),
    fakeRow({
      id: "verified-new",
      projectId: foundryId,
      createdAt: daysAgo(1),
      restoreVerificationAt: daysAgo(1),
      offsiteKey: null,
      offsiteStatus: "pending",
    }),
  ];
  const holdRows = [
    fakeRow({
      id: heldFailed,
      projectId: holdId,
      status: "failed",
      artifactValidationStatus: "skipped",
      restoreVerificationStatus: "skipped",
      createdAt: daysAgo(30),
      offsiteKey: null,
      offsiteStatus: "failed",
    }),
  ];
  const rowsByProject = new Map<string, BackupRow[]>([
    [foundryId, foundryRows],
    [holdId, holdRows],
  ]);

  await mkdir(path.join(dir, foundryId), { recursive: true });
  await mkdir(path.join(dir, holdId), { recursive: true });
  for (const id of [oldFailed, oldRestoreFailed, newestFailed]) {
    await writeFile(storage.localPathForBackup(foundryId, id), "dump");
  }
  await writeFile(storage.localPathForBackup(holdId, heldFailed), "dump");

  await withEnv(
    {
      FLUX_MIN_BACKUP_EXCLUDE_SLUGS: undefined,
      FLUX_MIN_BACKUP_EXCLUDE_USER_IDS: undefined,
      FLUX_DEMO_USER_ID: undefined,
    },
    async () => {
      const deleted = await sweepRetentionBatch({
        // Unordered, with the eligible project after the first 10 non-excluded rows.
        listProjects: async () => [excluded, ...early, foundry, hold],
        sweepProject: async (project) => {
          swept.push(project.slug);
          const rows = rowsByProject.get(project.id);
          if (!rows) return 0;
          return sweepProjectBackupRetention(project, {
            storage,
            listRows: async () => rows,
            deleteCatalogRow: async (id) => {
              deletedIds.push(id);
            },
          });
        },
      });

      assert.equal(deleted, 2);
      assert.deepEqual(deletedIds.sort(), [oldFailed, oldRestoreFailed].sort());
      assert.equal(swept.includes("flux-system"), false);
      assert.equal(swept.includes("flux-app-foundry"), true);
      assert.equal(swept.includes("late-hold"), true);
      assert.equal(swept.length, early.length + 2);
      for (const project of early) {
        assert.equal(swept.includes(project.slug), true);
      }
    },
  );

  await assert.rejects(
    () => access(storage.localPathForBackup(foundryId, oldFailed), constants.F_OK),
    { code: "ENOENT" },
  );
  await assert.rejects(
    () =>
      access(storage.localPathForBackup(foundryId, oldRestoreFailed), constants.F_OK),
    { code: "ENOENT" },
  );
  await access(storage.localPathForBackup(foundryId, newestFailed), constants.F_OK);
  await access(storage.localPathForBackup(holdId, heldFailed), constants.F_OK);
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
