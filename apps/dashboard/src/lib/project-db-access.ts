import {
  FLUX_PROJECT_HASH_HEX_LEN,
  redactDatabaseAccessPlan,
  resolveProjectDatabaseAccess,
  type DatabaseAccessPlan,
  type ResolveProjectDatabaseAccessOptions,
} from "@flux/core";
import { resolveCliRoleForUser } from "@/src/lib/cli-admin";

export type ProjectDbAccessRow = {
  id: string;
  slug: string;
  hash: string;
  mode: "v1_dedicated" | "v2_shared";
  apiSchemaName: string | null;
  apiSchemaStrategy: string | null;
  userId: string;
};

export type GetProjectDbAccessPlanInput = {
  hash: string;
  actorUserId: string;
  actorEmail?: string | null;
  actorName?: string | null;
  options?: ResolveProjectDatabaseAccessOptions;
};

export type GetProjectDbAccessPlanDeps = {
  findOwnedProject: (
    hash: string,
    userId: string,
  ) => Promise<ProjectDbAccessRow | null>;
  logAudit?: (event: {
    event: "db_access_metadata_viewed";
    userId: string;
    hash: string;
    slug: string;
    mode: "v1_dedicated" | "v2_shared";
    supported: boolean;
  }) => void;
};

export type GetProjectDbAccessPlanResult =
  | { ok: true; plan: DatabaseAccessPlan }
  | { ok: false; status: number; error: string };

export function isValidProjectHash(h: string): boolean {
  return (
    h.length === FLUX_PROJECT_HASH_HEX_LEN && /^[a-f0-9]+$/u.test(h)
  );
}

export function isProjectOwnerOrAdmin(
  project: ProjectDbAccessRow,
  actorUserId: string,
  actorEmail?: string | null,
  actorName?: string | null,
): boolean {
  if (project.userId === actorUserId) return true;
  return (
    resolveCliRoleForUser({
      userId: actorUserId,
      email: actorEmail,
      name: actorName,
    }) === "admin"
  );
}

export async function getProjectDbAccessPlan(
  input: GetProjectDbAccessPlanInput,
  deps: GetProjectDbAccessPlanDeps,
): Promise<GetProjectDbAccessPlanResult> {
  const hash = input.hash.trim().toLowerCase();
  if (!isValidProjectHash(hash)) {
    return {
      ok: false,
      status: 400,
      error: `hash in path must be a ${String(FLUX_PROJECT_HASH_HEX_LEN)}-char hex id`,
    };
  }

  const project = await deps.findOwnedProject(hash, input.actorUserId);
  if (!project) {
    return { ok: false, status: 404, error: "Project not found for this hash." };
  }

  if (
    !isProjectOwnerOrAdmin(
      project,
      input.actorUserId,
      input.actorEmail,
      input.actorName,
    )
  ) {
    return { ok: false, status: 403, error: "Forbidden." };
  }

  const plan = redactDatabaseAccessPlan(
    resolveProjectDatabaseAccess(
      {
        id: project.id,
        slug: project.slug,
        hash: project.hash,
        mode: project.mode,
        apiSchemaName: project.apiSchemaName,
        apiSchemaStrategy: project.apiSchemaStrategy as
          | "legacy_api"
          | "tenant_schema"
          | null,
      },
      input.options,
    ),
  );

  deps.logAudit?.({
    event: "db_access_metadata_viewed",
    userId: input.actorUserId,
    hash: project.hash,
    slug: project.slug,
    mode: project.mode,
    supported: plan.mode === "v1_dedicated" ? plan.supported : false,
  });

  return { ok: true, plan };
}

export function logDbAccessAudit(event: {
  event: "db_access_metadata_viewed";
  userId: string;
  hash: string;
  slug: string;
  mode: "v1_dedicated" | "v2_shared";
  supported: boolean;
}): void {
  console.info(
    JSON.stringify({
      ...event,
      at: new Date().toISOString(),
    }),
  );
}
