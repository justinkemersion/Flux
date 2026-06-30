/**
 * In-memory store for migration plans produced by `flux.migration.plan`.
 *
 * Pass 2 only plans; it never applies. Plans are kept in process memory so a
 * future `flux.migration.apply` (Pass 3) can require a previously-issued
 * `planId` instead of trusting ad-hoc apply requests. Nothing here is durable.
 */

export interface StoredMigrationFile {
  version: string;
  filename: string;
  checksum: string;
}

export interface StoredMigrationConflict {
  version: string;
  filename: string;
  checksum: string;
  appliedChecksum: string;
}

export interface StoredMigrationPlan {
  planId: string;
  planHash: string;
  hash: string;
  slug?: string;
  migrationsDir: string;
  createdAt: string;
  apply: StoredMigrationFile[];
  skip: StoredMigrationFile[];
  conflicts: StoredMigrationConflict[];
  destructiveShaped: boolean;
}

const plans = new Map<string, StoredMigrationPlan>();

export function storeMigrationPlan(plan: StoredMigrationPlan): void {
  plans.set(plan.planId, plan);
}

export function getMigrationPlan(planId: string): StoredMigrationPlan | undefined {
  return plans.get(planId);
}

export function clearMigrationPlans(): void {
  plans.clear();
}
