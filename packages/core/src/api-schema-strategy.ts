/**
 * Canonical PostgREST API schema per project (legacy `api` vs mirrored `t_<shortId>_api`).
 */

import { deriveShortId } from "./standalone.ts";

/** v1 dedicated / flux-system default PostgREST schema name (historical Supabase-style layout). */
export const LEGACY_FLUX_API_SCHEMA = "api" as const;

export type ApiSchemaStrategy = "legacy_api" | "tenant_schema";

export type ProjectApiSchemaInput = {
  id: string;
  mode: "v1_dedicated" | "v2_shared";
  apiSchemaName?: string | null;
  apiSchemaStrategy?: ApiSchemaStrategy | null;
};

/** When truthy, new v1_dedicated projects use the mirrored tenant schema name. */
export function fluxV1TenantSchemaEnabled(): boolean {
  const v = process.env.FLUX_V1_TENANT_SCHEMA?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertFluxApiSchemaIdentifier(name: string): void {
  if (!IDENT_RE.test(name)) {
    throw new Error(
      `Invalid API schema identifier "${name}" (expected /^[A-Za-z_][A-Za-z0-9_]*$/)`,
    );
  }
}

/**
 * 12-hex segment from catalog project UUID (same algorithm as v2 pooled push / engine-v2).
 */
export function deriveTenantSchemaShortId(projectId: string): string {
  const shortId = deriveShortId(projectId);
  if (!/^[a-f0-9]{12}$/.test(shortId)) {
    throw new Error(
      `Cannot derive tenant short id: invalid shortId "${shortId}" from project id`,
    );
  }
  return shortId;
}

/**
 * `t_<12 hex>_api` derived from catalog UUID (same algorithm as v2 pooled push).
 */
export function defaultTenantApiSchemaFromProjectId(projectId: string): string {
  return `t_${deriveTenantSchemaShortId(projectId)}_api`;
}

/**
 * Per-tenant DB role on the shared cluster (`SET ROLE` target in gateway-minted JWTs).
 * Must stay aligned with {@link defaultTenantApiSchemaFromProjectId} naming.
 */
export function defaultTenantRoleFromProjectId(projectId: string): string {
  return `t_${deriveTenantSchemaShortId(projectId)}_role`;
}

/**
 * Resolves the schema PostgREST exposes as the primary API schema (first entry in PGRST_DB_SCHEMAS).
 */
export function resolveTenantApiSchemaName(
  project: ProjectApiSchemaInput,
): string {
  const explicit = project.apiSchemaName?.trim();
  if (explicit) {
    assertFluxApiSchemaIdentifier(explicit);
    return explicit;
  }
  if (project.mode === "v2_shared") {
    return defaultTenantApiSchemaFromProjectId(project.id);
  }
  if (project.apiSchemaStrategy === "tenant_schema") {
    return defaultTenantApiSchemaFromProjectId(project.id);
  }
  return LEGACY_FLUX_API_SCHEMA;
}

export function isTenantSchemaStrategyProject(project: ProjectApiSchemaInput): boolean {
  if (project.mode === "v2_shared") return true;
  return project.apiSchemaStrategy === "tenant_schema";
}

/**
 * Schema name to use when provisioning a **new** v1_dedicated stack before a catalog row exists.
 * When the feature flag is off, returns `api`.
 */
export function resolveV1ProvisionApiSchemaName(projectId: string): string {
  if (fluxV1TenantSchemaEnabled()) {
    return defaultTenantApiSchemaFromProjectId(projectId);
  }
  return LEGACY_FLUX_API_SCHEMA;
}
