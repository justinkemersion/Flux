export type ProjectMode = "v1_dedicated" | "v2_shared";

export interface TenantResolution {
  projectId: string;
  tenantId: string;
  shortid: string;
  mode: ProjectMode;
  slug: string;
  /** Per-project HS256 key (Base64); null until backfilled by repair. */
  jwtSecret: string | null;
  /**
   * Catalog `projects.migration_status`. Exact value `migrating` drains traffic (503);
   * `migrating_no_drain` is mutex-only and does not block the gateway.
   */
  migrationStatus: string | null;
}
