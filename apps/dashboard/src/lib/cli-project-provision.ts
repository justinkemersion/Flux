import { and, count, eq } from "drizzle-orm";
import type { FluxProjectSummary } from "@flux/core/standalone";
import {
  fluxApiUrlForCatalog,
  fluxV1TenantSchemaEnabled,
  generateProjectHash,
  resolveTenantApiSchemaName,
  slugifyProjectName,
} from "@flux/core";
import { projects, users } from "@/src/db/schema";
import type { getDb } from "@/src/lib/db";
import { getProjectManager } from "@/src/lib/flux";
import { probeSingleProject } from "@/src/lib/fleet-monitor";
import { dispatchProvisionProject } from "@/src/lib/provisioning-engine";
import { resolveCreateModeForPlan, type UserPlan } from "@/src/lib/cli-mode-policy";

export const HOBBY_PROJECT_LIMIT = 2;
export const PRO_PROJECT_LIMIT = 10;
export const HOBBY_LIMIT_ERROR =
  "Project limit reached. Please upgrade to Pro.";
export const PRO_LIMIT_ERROR =
  "Project limit reached (10 projects on Pro).";

const HASH_ALLOC_ATTEMPTS = 32;

export type ProjectMode = "v1_dedicated" | "v2_shared";

export type CliInitProjectPayload = {
  action: "linked" | "created";
  slug: string;
  hash: string;
  mode: ProjectMode;
  apiUrl: string;
  apiSchema: string;
};

type CatalogRow = {
  id: string;
  slug: string;
  hash: string;
  mode: ProjectMode;
  apiSchemaName: string | null;
  apiSchemaStrategy: string | null;
};

export function initialApiSchemaStrategy(mode: ProjectMode): string | null {
  if (mode === "v2_shared") return null;
  return fluxV1TenantSchemaEnabled() ? "tenant_schema" : "legacy_api";
}

export function describeProvisionError(err: unknown): string {
  const e = err as { message?: unknown; cause?: unknown } | null;
  const cause = e?.cause as
    | { message?: unknown; detail?: unknown; code?: unknown }
    | undefined;
  const causeMsg =
    typeof cause?.message === "string" ? cause.message : undefined;
  const causeDetail =
    typeof cause?.detail === "string" ? cause.detail : undefined;
  const causeCode = typeof cause?.code === "string" ? cause.code : undefined;
  if (causeMsg) {
    const parts = [causeMsg];
    if (causeDetail) parts.push(causeDetail);
    if (causeCode) parts.push(`(pg ${causeCode})`);
    return parts.join(" — ");
  }
  if (typeof e?.message === "string") return e.message;
  return String(err);
}

export async function allocateUniqueProjectHash(
  db: ReturnType<typeof getDb>,
  userId: string,
): Promise<string | null> {
  for (let i = 0; i < HASH_ALLOC_ATTEMPTS; i++) {
    const hash = generateProjectHash();
    const clash = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.userId, userId), eq(projects.hash, hash)))
      .limit(1);
    if (clash.length === 0) return hash;
  }
  return null;
}

export function parseOptionalMode(
  body: Record<string, unknown>,
): ProjectMode | undefined | "invalid" {
  if (!("mode" in body)) return undefined;
  const mode = body.mode;
  if (mode === "v1_dedicated" || mode === "v2_shared") return mode;
  return "invalid";
}

export function parseOptionalStripSupabase(
  body: Record<string, unknown>,
): boolean | undefined {
  if (
    "stripSupabaseRestPrefix" in body &&
    typeof body.stripSupabaseRestPrefix === "boolean"
  ) {
    return body.stripSupabaseRestPrefix;
  }
  return undefined;
}

export async function loadUserPlan(
  db: ReturnType<typeof getDb>,
  userId: string,
): Promise<"hobby" | "pro"> {
  const [userRow] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId));
  return userRow?.plan === "pro" ? "pro" : "hobby";
}

export async function countUserProjects(
  db: ReturnType<typeof getDb>,
  userId: string,
): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(projects)
    .where(eq(projects.userId, userId));
  return n;
}

export function assertWithinProjectLimit(
  plan: UserPlan,
  projectCount: number,
): { ok: true } | { ok: false; message: string } {
  if (plan === "hobby" && projectCount >= HOBBY_PROJECT_LIMIT) {
    return { ok: false, message: HOBBY_LIMIT_ERROR };
  }
  if (plan === "pro" && projectCount >= PRO_PROJECT_LIMIT) {
    return { ok: false, message: PRO_LIMIT_ERROR };
  }
  return { ok: true };
}

export function buildInitPayloadFromCatalogRow(
  row: CatalogRow,
  isProduction: boolean,
): CliInitProjectPayload {
  const slug = slugifyProjectName(row.slug);
  const apiSchema = resolveTenantApiSchemaName({
    id: row.id,
    mode: row.mode,
    apiSchemaName: row.apiSchemaName,
    apiSchemaStrategy: row.apiSchemaStrategy as
      | "legacy_api"
      | "tenant_schema"
      | null,
  });
  return {
    action: "linked",
    slug,
    hash: row.hash,
    mode: row.mode,
    apiUrl: fluxApiUrlForCatalog(slug, row.hash, isProduction, row.mode),
    apiSchema,
  };
}

export async function findCatalogRowBySlug(
  db: ReturnType<typeof getDb>,
  userId: string,
  slug: string,
): Promise<CatalogRow | null> {
  const [row] = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      hash: projects.hash,
      mode: projects.mode,
      apiSchemaName: projects.apiSchemaName,
      apiSchemaStrategy: projects.apiSchemaStrategy,
    })
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.slug, slug)))
    .limit(1);
  return row ?? null;
}

export type ProvisionInsertResult =
  | {
      ok: true;
      tenantId: string;
      summary: FluxProjectSummary;
      mode: ProjectMode;
      projectJwtSecret: string;
      secrets: Awaited<ReturnType<typeof dispatchProvisionProject>>["secrets"];
    }
  | { ok: false; status: number; message: string };

export async function provisionProjectForUser(input: {
  db: ReturnType<typeof getDb>;
  userId: string;
  projectName: string;
  slug: string;
  mode: ProjectMode;
  stripSupabaseRestPrefix?: boolean;
  isProduction: boolean;
}): Promise<ProvisionInsertResult> {
  const projectHash = await allocateUniqueProjectHash(input.db, input.userId);
  if (projectHash === null) {
    return {
      ok: false,
      status: 503,
      message: "Could not allocate a unique project hash; retry the request.",
    };
  }

  const pm = getProjectManager();
  const tenantId = crypto.randomUUID();
  let project: Awaited<ReturnType<typeof dispatchProvisionProject>>;
  try {
    project = await dispatchProvisionProject({
      mode: input.mode,
      projectName: input.projectName,
      projectHash,
      tenantId,
      projectManager: pm,
      ...(input.stripSupabaseRestPrefix !== undefined
        ? { stripSupabaseRestPrefix: input.stripSupabaseRestPrefix }
        : {}),
      isProduction: input.isProduction,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Invalid project name")) {
      return { ok: false, status: 400, message };
    }
    return { ok: false, status: 500, message };
  }

  try {
    const [dbRow] = await input.db
      .insert(projects)
      .values({
        name: project.name,
        slug: project.slug,
        hash: project.hash,
        id: tenantId,
        userId: input.userId,
        mode: input.mode,
        jwtSecret: project.projectJwtSecret,
        apiSchemaStrategy: initialApiSchemaStrategy(input.mode),
      })
      .returning({ id: projects.id });
    try {
      await probeSingleProject(dbRow.id);
    } catch (probeErr: unknown) {
      console.error(
        "[flux] cli provision: immediate mesh probe failed (non-fatal):",
        probeErr,
      );
    }
  } catch (err: unknown) {
    await project.cleanupOnFailure();
    const message = describeProvisionError(err);
    console.error(
      `[flux] cli provision: projects.insert failed after provision slug=${project.slug} hash=${project.hash}: ${message}`,
      err,
    );
    return { ok: false, status: 500, message };
  }

  const summary: FluxProjectSummary = {
    slug: project.slug,
    hash: project.hash,
    status: "running",
    apiUrl: project.apiUrl,
  };

  return {
    ok: true,
    tenantId,
    summary,
    mode: input.mode,
    projectJwtSecret: project.projectJwtSecret,
    secrets: project.secrets,
  };
}

export function buildInitPayloadFromProvision(
  summary: FluxProjectSummary,
  mode: ProjectMode,
  tenantId: string,
  apiSchemaStrategy: string | null,
): CliInitProjectPayload {
  const apiSchema = resolveTenantApiSchemaName({
    id: tenantId,
    mode,
    apiSchemaName: null,
    apiSchemaStrategy: apiSchemaStrategy as "legacy_api" | "tenant_schema" | null,
  });
  return {
    action: "created",
    slug: summary.slug,
    hash: summary.hash,
    mode,
    apiUrl: summary.apiUrl,
    apiSchema,
  };
}

export { resolveCreateModeForPlan, slugifyProjectName };
