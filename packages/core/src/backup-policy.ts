import { isPlatformSystemStackSlug } from "./docker/docker-names.ts";

export type PlatformBackupPolicy = {
  intervalDays: number;
  retentionCount: number;
  retentionDays: number;
  maxPipelinesPerTick: number;
  /** Cap when the freshness scheduler has never completed a tick (launch bootstrap). */
  bootstrapMaxPipelinesOnFirstRun: number;
  excludeSlugs: ReadonlySet<string>;
  excludeUserIds: ReadonlySet<string>;
};

/** Catalog key in `platform_scheduler_state` for the hourly freshness scheduler. */
export const PLATFORM_MINIMUM_BACKUP_FRESHNESS_SCHEDULER_ID =
  "platform_minimum_backup_freshness";

export type UserBackupPolicyPrefs = {
  intervalDays?: number | null;
  retentionCount?: number | null;
  retentionDays?: number | null;
};

export type EffectiveBackupPolicy = {
  intervalDays: number;
  retentionCount: number;
  retentionDays: number;
};

export type BackupFreshnessTier =
  | "fresh"
  | "stale"
  | "never_verified"
  | "no_backups";

export type BackupFreshnessClassification = {
  tier: BackupFreshnessTier;
  /** Days since newest restore-verified backup; null when none verified. */
  ageDays: number | null;
  /** Days until stale threshold; null when never verified or no backups. */
  dueInDays: number | null;
  latestRestoreVerifiedAt: string | null;
  platformBackupCompliant: boolean;
  detail: string;
};

const DEFAULT_EXCLUDED_SLUGS = new Set(["static"]);

function readPositiveInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseCsvSet(env: NodeJS.ProcessEnv, key: string): Set<string> {
  const raw = env[key]?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function parsePlatformBackupPolicy(
  env: NodeJS.ProcessEnv = process.env,
): PlatformBackupPolicy {
  const excludeSlugs = new Set([
    ...DEFAULT_EXCLUDED_SLUGS,
    ...parseCsvSet(env, "FLUX_MIN_BACKUP_EXCLUDE_SLUGS"),
  ]);
  return {
    intervalDays: readPositiveInt(env, "FLUX_MIN_BACKUP_INTERVAL_DAYS", 7),
    retentionCount: readPositiveInt(env, "FLUX_MIN_BACKUP_RETENTION_COUNT", 4),
    retentionDays: readPositiveInt(env, "FLUX_MIN_BACKUP_RETENTION_DAYS", 30),
    maxPipelinesPerTick: readPositiveInt(
      env,
      "FLUX_MIN_BACKUP_MAX_PIPELINES_PER_TICK",
      1,
    ),
    bootstrapMaxPipelinesOnFirstRun: readPositiveInt(
      env,
      "FLUX_MIN_BACKUP_BOOTSTRAP_MAX_PIPELINES",
      10,
    ),
    excludeSlugs,
    excludeUserIds: parseCsvSet(env, "FLUX_MIN_BACKUP_EXCLUDE_USER_IDS"),
  };
}

/** User prefs may increase frequency/retention but never go below platform minimum. */
export function resolveEffectiveBackupPolicy(
  platform: PlatformBackupPolicy,
  user?: UserBackupPolicyPrefs | null,
): EffectiveBackupPolicy {
  const intervalDays = Math.max(
    platform.intervalDays,
    user?.intervalDays ?? platform.intervalDays,
  );
  const retentionCount = Math.max(
    platform.retentionCount,
    user?.retentionCount ?? platform.retentionCount,
  );
  const retentionDays = Math.max(
    platform.retentionDays,
    user?.retentionDays ?? platform.retentionDays,
  );
  return { intervalDays, retentionCount, retentionDays };
}

export function isPlatformBackupFreshnessSchedulerExcluded(input: {
  slug: string;
  userId: string;
  excludeSlugs?: ReadonlySet<string>;
  excludeUserIds?: ReadonlySet<string>;
}): boolean {
  if (isPlatformSystemStackSlug(input.slug)) return true;
  const slugs = input.excludeSlugs ?? DEFAULT_EXCLUDED_SLUGS;
  if (slugs.has(input.slug)) return true;
  if (input.excludeUserIds?.has(input.userId)) return true;
  return false;
}

export function classifyBackupFreshness(input: {
  latestRestoreVerifiedAt: Date | null | undefined;
  hasAnyBackups: boolean;
  intervalDays: number;
  now?: Date;
}): BackupFreshnessClassification {
  const now = input.now ?? new Date();
  const intervalMs = input.intervalDays * 24 * 60 * 60 * 1000;

  if (!input.hasAnyBackups) {
    return {
      tier: "no_backups",
      ageDays: null,
      dueInDays: null,
      latestRestoreVerifiedAt: null,
      platformBackupCompliant: false,
      detail: "No backups exist for this project.",
    };
  }

  const verifiedAt = input.latestRestoreVerifiedAt ?? null;
  if (!verifiedAt || Number.isNaN(verifiedAt.getTime())) {
    return {
      tier: "never_verified",
      ageDays: null,
      dueInDays: null,
      latestRestoreVerifiedAt: null,
      platformBackupCompliant: false,
      detail:
        "No restore-verified backup yet. Platform minimum backup freshness requires a verified backup within the interval.",
    };
  }

  const ageMs = now.getTime() - verifiedAt.getTime();
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  const iso = verifiedAt.toISOString();

  if (ageMs <= intervalMs) {
    const dueInDays = Math.ceil((intervalMs - ageMs) / (24 * 60 * 60 * 1000));
    return {
      tier: "fresh",
      ageDays,
      dueInDays,
      latestRestoreVerifiedAt: iso,
      platformBackupCompliant: true,
      detail: `Newest restore-verified backup is ${String(ageDays)} day(s) old (within ${String(input.intervalDays)}-day platform minimum).`,
    };
  }

  return {
    tier: "stale",
    ageDays,
    dueInDays: 0,
    latestRestoreVerifiedAt: iso,
    platformBackupCompliant: false,
    detail: `Newest restore-verified backup is ${String(ageDays)} day(s) old (platform minimum: ${String(input.intervalDays)} days).`,
  };
}

export function backupFreshnessTierLabel(tier: BackupFreshnessTier): string {
  switch (tier) {
    case "fresh":
      return "Platform minimum backup freshness: compliant";
    case "stale":
      return "Platform minimum backup freshness: overdue";
    case "never_verified":
      return "Platform minimum backup freshness: never verified";
    case "no_backups":
      return "Platform minimum backup freshness: no backups";
    default: {
      const _x: never = tier;
      return _x;
    }
  }
}

/** Select restore-verified catalog rows eligible for local retention deletion (newest first). */
export function selectRestoreVerifiedBackupsForRetention(input: {
  rows: ReadonlyArray<{
    id: string;
    status: string;
    restoreVerificationStatus: string | null | undefined;
    restoreVerificationAt: Date | null | undefined;
  }>;
  retentionCount: number;
  retentionDays: number;
  now?: Date;
}): string[] {
  const now = input.now ?? new Date();
  const cutoffMs = now.getTime() - input.retentionDays * 24 * 60 * 60 * 1000;

  const verified = input.rows
    .filter(
      (r) =>
        r.status === "complete" &&
        r.restoreVerificationStatus === "restore_verified" &&
        r.restoreVerificationAt instanceof Date &&
        !Number.isNaN(r.restoreVerificationAt.getTime()),
    )
    .sort(
      (a, b) =>
        b.restoreVerificationAt!.getTime() - a.restoreVerificationAt!.getTime(),
    );

  const toDelete: string[] = [];
  for (let i = 0; i < verified.length; i++) {
    const row = verified[i]!;
    if (i < input.retentionCount) continue;
    if (row.restoreVerificationAt!.getTime() >= cutoffMs) continue;
    toDelete.push(row.id);
  }
  return toDelete;
}

/** How many full backup pipelines to run this scheduler tick. */
export function resolvePlatformBackupSchedulerBatchSize(input: {
  dueCount: number;
  maxPipelinesPerTick: number;
  bootstrapMaxPipelinesOnFirstRun: number;
  isFirstRun: boolean;
}): number {
  if (input.dueCount <= 0) return 0;
  if (input.isFirstRun) {
    return Math.min(input.dueCount, input.bootstrapMaxPipelinesOnFirstRun);
  }
  return Math.min(input.dueCount, input.maxPipelinesPerTick);
}
