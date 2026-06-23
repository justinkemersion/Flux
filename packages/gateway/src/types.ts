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
  /** Catalog `projects.lifecycle_state`. Non-active states drain tenant API traffic (503). */
  lifecycleState: ProjectLifecycleState;
}

export type ProjectLifecycleState = "active" | "dormant" | "archived";

export const FLUX_GATEWAY_DRAINING_LIFECYCLE_STATES: readonly ProjectLifecycleState[] =
  ["dormant", "archived"];

export function gatewayBlocksLifecycleState(
  state: string | null | undefined,
): state is "dormant" | "archived" {
  return state === "dormant" || state === "archived";
}

export function lifecycleGatewayErrorMessage(
  state: ProjectLifecycleState,
): string {
  if (state === "dormant") {
    return "project is dormant; wake the project to resume API traffic";
  }
  return "project is archived; wake the project to resume API traffic";
}
