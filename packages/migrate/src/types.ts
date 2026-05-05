export type MigrationPhase =
  | "planning"
  | "provisioning_target"
  | "dumping"
  | "restoring"
  | "validating"
  | "switching"
  | "complete"
  | "failed";

export type MigrationPlan = {
  projectSlug: string;
  projectId: string;
  shortId: string;
  tenantSchema: string;
  source: { mode: "v2_shared"; schema: string };
  target: { mode: "v1_dedicated"; schema: string };
  preserveJwtSecret: boolean;
  lockWrites: boolean;
};

export type TableRowCount = { table: string; n: number };

export type MigrationPreflight = {
  schemaComment: string | null;
  tableCounts: TableRowCount[];
  extensions: string[];
};

export type MigrateCliPayload = {
  slug: string;
  hash: string;
  dryRun?: boolean;
  yes?: boolean;
  /** Full migration but do not flip mode / catalog (provision + dump + restore + validate). */
  staged?: boolean;
  /** Stop after writing dump to temp path (debug). */
  dumpOnly?: boolean;
  preserveJwtSecret?: boolean;
  newJwtSecret?: boolean;
  lockWrites?: boolean;
  noLockWrites?: boolean;
  dropSourceAfter?: boolean;
};

export type MigrateApiResult =
  | {
      ok: true;
      dryRun?: boolean;
      plan?: MigrationPlan;
      preflight?: MigrationPreflight;
      message?: string;
    }
  | { ok: false; phase: MigrationPhase; error: string };
