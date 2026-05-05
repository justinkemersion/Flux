/**
 * Canonical PostgREST API schema per project (legacy `api` vs mirrored `t_<shortId>_api`).
 */

import { deriveShortId } from "./standalone.ts";

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
 * `t_<12 hex>_api` derived from catalog UUID (same algorithm as v2 pooled push).
 */
export function defaultTenantApiSchemaFromProjectId(projectId: string): string {
  const shortId = deriveShortId(projectId);
  if (!/^[a-f0-9]{12}$/.test(shortId)) {
    throw new Error(
      `Cannot derive tenant API schema: invalid shortId "${shortId}" from project id`,
    );
  }
  return `t_${shortId}_api`;
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
  return "api";
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
  return "api";
}
