import test from "node:test";
import assert from "node:assert/strict";
import {
  backupFreshnessTierLabel,
  classifyBackupFreshness,
  isPlatformBackupFreshnessSchedulerExcluded,
  parsePlatformBackupPolicy,
  resolveEffectiveBackupPolicy,
  resolvePlatformBackupSchedulerBatchSize,
  selectRestoreVerifiedBackupsForRetention,
} from "./backup-policy.ts";

test("parsePlatformBackupPolicy defaults", () => {
  const p = parsePlatformBackupPolicy({});
  assert.equal(p.intervalDays, 7);
  assert.equal(p.retentionCount, 4);
  assert.equal(p.retentionDays, 30);
  assert.equal(p.maxPipelinesPerTick, 1);
  assert.equal(p.bootstrapMaxPipelinesOnFirstRun, 10);
  assert.ok(p.excludeSlugs.has("static"));
});

test("resolveEffectiveBackupPolicy floors user prefs", () => {
  const platform = parsePlatformBackupPolicy({
    FLUX_MIN_BACKUP_INTERVAL_DAYS: "7",
    FLUX_MIN_BACKUP_RETENTION_COUNT: "4",
    FLUX_MIN_BACKUP_RETENTION_DAYS: "30",
  });
  const eff = resolveEffectiveBackupPolicy(platform, {
    intervalDays: 3,
    retentionCount: 2,
    retentionDays: 14,
  });
  assert.equal(eff.intervalDays, 7);
  assert.equal(eff.retentionCount, 4);
  assert.equal(eff.retentionDays, 30);
});

test("resolveEffectiveBackupPolicy allows increases", () => {
  const platform = parsePlatformBackupPolicy({});
  const eff = resolveEffectiveBackupPolicy(platform, {
    intervalDays: 14,
    retentionCount: 8,
    retentionDays: 90,
  });
  assert.equal(eff.intervalDays, 14);
  assert.equal(eff.retentionCount, 8);
  assert.equal(eff.retentionDays, 90);
});

test("classifyBackupFreshness fresh vs stale boundary", () => {
  const now = new Date("2026-06-20T12:00:00.000Z");
  const fresh = classifyBackupFreshness({
    hasAnyBackups: true,
    latestRestoreVerifiedAt: new Date("2026-06-15T12:00:00.000Z"),
    intervalDays: 7,
    now,
  });
  assert.equal(fresh.tier, "fresh");
  assert.equal(fresh.platformBackupCompliant, true);

  const stale = classifyBackupFreshness({
    hasAnyBackups: true,
    latestRestoreVerifiedAt: new Date("2026-06-10T12:00:00.000Z"),
    intervalDays: 7,
    now,
  });
  assert.equal(stale.tier, "stale");
  assert.equal(stale.platformBackupCompliant, false);
});

test("scheduler exclusions", () => {
  assert.equal(
    isPlatformBackupFreshnessSchedulerExcluded({
      slug: "flux-system",
      userId: "u1",
    }),
    true,
  );
  assert.equal(
    isPlatformBackupFreshnessSchedulerExcluded({
      slug: "static",
      userId: "u1",
    }),
    true,
  );
  assert.equal(
    isPlatformBackupFreshnessSchedulerExcluded({
      slug: "my-app",
      userId: "demo-user",
      excludeUserIds: new Set(["demo-user"]),
    }),
    true,
  );
  assert.equal(
    isPlatformBackupFreshnessSchedulerExcluded({
      slug: "my-app",
      userId: "u1",
    }),
    false,
  );
});

test("selectRestoreVerifiedBackupsForRetention keeps verified count", () => {
  const now = new Date("2026-06-20T00:00:00.000Z");
  const mk = (id: string, daysAgo: number) => ({
    id,
    status: "complete",
    restoreVerificationStatus: "restore_verified",
    restoreVerificationAt: new Date(now.getTime() - daysAgo * 86400000),
  });
  const ids = selectRestoreVerifiedBackupsForRetention({
    rows: [mk("a", 1), mk("b", 5), mk("c", 10), mk("d", 40), mk("e", 50)],
    retentionCount: 4,
    retentionDays: 30,
    now,
  });
  assert.deepEqual(ids, ["e"]);
});

test("complete but unverified rows do not count toward retention floor", () => {
  const now = new Date("2026-06-20T00:00:00.000Z");
  const ids = selectRestoreVerifiedBackupsForRetention({
    rows: [
      {
        id: "unverified",
        status: "complete",
        restoreVerificationStatus: "pending",
        restoreVerificationAt: null,
      },
      {
        id: "old-verified",
        status: "complete",
        restoreVerificationStatus: "restore_verified",
        restoreVerificationAt: new Date(now.getTime() - 60 * 86400000),
      },
    ],
    retentionCount: 4,
    retentionDays: 30,
    now,
  });
  assert.deepEqual(ids, []);
});

test("backupFreshnessTierLabel uses platform minimum wording", () => {
  assert.match(backupFreshnessTierLabel("fresh"), /Platform minimum backup freshness/);
});

test("resolvePlatformBackupSchedulerBatchSize uses bootstrap cap on first run", () => {
  assert.equal(
    resolvePlatformBackupSchedulerBatchSize({
      dueCount: 25,
      maxPipelinesPerTick: 1,
      bootstrapMaxPipelinesOnFirstRun: 10,
      isFirstRun: true,
    }),
    10,
  );
  assert.equal(
    resolvePlatformBackupSchedulerBatchSize({
      dueCount: 3,
      maxPipelinesPerTick: 1,
      bootstrapMaxPipelinesOnFirstRun: 10,
      isFirstRun: true,
    }),
    3,
  );
});

test("resolvePlatformBackupSchedulerBatchSize uses normal cap after first run", () => {
  assert.equal(
    resolvePlatformBackupSchedulerBatchSize({
      dueCount: 25,
      maxPipelinesPerTick: 1,
      bootstrapMaxPipelinesOnFirstRun: 10,
      isFirstRun: false,
    }),
    1,
  );
});
