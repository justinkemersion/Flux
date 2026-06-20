import {
  classifyBackupFreshness,
  isPlatformBackupFreshnessSchedulerExcluded,
  parsePlatformBackupPolicy,
  resolveEffectiveBackupPolicy,
  type BackupFreshnessClassification,
  type EffectiveBackupPolicy,
  type PlatformBackupPolicy,
} from "@flux/core/backup-policy";
import { demoUserId } from "@/src/lib/demo-auth";

export function getPlatformBackupPolicy(): PlatformBackupPolicy {
  const policy = parsePlatformBackupPolicy();
  const demo = demoUserId();
  if (demo) {
    const userIds = new Set(policy.excludeUserIds);
    userIds.add(demo);
    return { ...policy, excludeUserIds: userIds };
  }
  return policy;
}

export function isSchedulerExcludedProject(input: {
  slug: string;
  userId: string;
}): boolean {
  const policy = getPlatformBackupPolicy();
  return isPlatformBackupFreshnessSchedulerExcluded({
    slug: input.slug,
    userId: input.userId,
    excludeSlugs: policy.excludeSlugs,
    excludeUserIds: policy.excludeUserIds,
  });
}

export function effectivePolicyForProjectRow(row: {
  backupIntervalDays?: number | null;
  backupRetentionCount?: number | null;
  backupRetentionDays?: number | null;
}): EffectiveBackupPolicy {
  return resolveEffectiveBackupPolicy(getPlatformBackupPolicy(), {
    intervalDays: row.backupIntervalDays,
    retentionCount: row.backupRetentionCount,
    retentionDays: row.backupRetentionDays,
  });
}

export function classifyProjectBackupFreshness(input: {
  latestRestoreVerifiedAt: Date | null | undefined;
  hasAnyBackups: boolean;
  effectivePolicy: EffectiveBackupPolicy;
}): BackupFreshnessClassification {
  return classifyBackupFreshness({
    latestRestoreVerifiedAt: input.latestRestoreVerifiedAt,
    hasAnyBackups: input.hasAnyBackups,
    intervalDays: input.effectivePolicy.intervalDays,
  });
}
