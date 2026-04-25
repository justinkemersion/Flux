export type ProjectMode = "v1_dedicated" | "v2_shared";

export interface TenantResolution {
  projectId: string;
  tenantId: string;
  shortid: string;
  mode: ProjectMode;
  slug: string;
}
