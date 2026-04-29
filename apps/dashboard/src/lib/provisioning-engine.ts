import { randomBytes } from "node:crypto";
import { fluxApiUrlForSlug, slugifyProjectName } from "@flux/core";
import type { ProjectManager } from "@flux/core";
import { deprovisionProject } from "@flux/engine-v2";
import { getEngineV2 } from "@/src/lib/flux";

export type ProjectMode = "v1_dedicated" | "v2_shared";

/** 36 random bytes → 48-character standard Base64 — per-project tenant JWT verification key. */
export function generateProjectJwtSecret(): string {
  return randomBytes(36).toString("base64");
}

export type DispatchProvisionInput = {
  mode: ProjectMode;
  projectName: string;
  projectHash: string;
  tenantId: string;
  projectManager: ProjectManager;
  isProduction: boolean;
  customJwtSecret?: string;
  stripSupabaseRestPrefix?: boolean;
  /** Injectable for tests — defaults to engine-v2 provisionProject. */
  provisionSharedTenant?: (
    tenantId: string,
  ) => Promise<{ tenantId: string; shortId: string; schema: string; role: string }>;
  /** Injectable for tests — defaults to engine-v2 deprovisionProject. */
  deprovisionSharedTenant?: (tenantId: string) => Promise<void>;
};

type BaseProvisionResult = {
  mode: ProjectMode;
  name: string;
  slug: string;
  hash: string;
  apiUrl: string;
  cleanupOnFailure: () => Promise<void>;
};

type V1ProvisionResult = BaseProvisionResult & {
  mode: "v1_dedicated";
  stripSupabaseRestPrefix: boolean;
  /** PostgREST HS256 secret — same value stored as `projects.jwt_secret`. */
  projectJwtSecret: string;
  secrets: {
    pgrstJwtSecret: string;
    postgresPassword: string;
    postgresContainerHost: string;
    note: string;
  };
};

type V2ProvisionResult = BaseProvisionResult & {
  mode: "v2_shared";
  stripSupabaseRestPrefix: boolean;
  tenant: {
    tenantId: string;
    shortId: string;
    schema: string;
    role: string;
  };
  /** Same bytes persisted as `projects.jwt_secret` — tenant-facing credential. */
  projectJwtSecret: string;
  secrets: {
    pgrstJwtSecret: string;
    postgresPassword: string;
    postgresContainerHost: string;
    note: string;
  };
};

export type DispatchProvisionResult = V1ProvisionResult | V2ProvisionResult;

/**
 * Route-level mode dispatch for project provisioning.
 *
 * v2_shared (Standard/Free): provisions a tenant schema/role in the shared
 *   Postgres cluster via engine-v2. No per-project Docker containers.
 * v1_dedicated (Pro/Isolated): spins up dedicated Docker containers
 *   (Postgres + PostgREST) per tenant via the project manager.
 */
export async function dispatchProvisionProject(
  input: DispatchProvisionInput,
): Promise<DispatchProvisionResult> {
  if (input.mode === "v1_dedicated") {
    const provisioned = await input.projectManager.provisionProject(
      input.projectName,
      {
        ...(input.customJwtSecret ? { customJwtSecret: input.customJwtSecret } : {}),
        ...(input.stripSupabaseRestPrefix !== undefined
          ? { stripSupabaseRestPrefix: input.stripSupabaseRestPrefix }
          : {}),
        isProduction: input.isProduction,
      },
      input.projectHash,
    );
    return {
      mode: "v1_dedicated",
      name: provisioned.name,
      slug: provisioned.slug,
      hash: provisioned.hash,
      apiUrl: provisioned.apiUrl,
      stripSupabaseRestPrefix: provisioned.stripSupabaseRestPrefix,
      projectJwtSecret: provisioned.jwtSecret,
      secrets: {
        pgrstJwtSecret: provisioned.jwtSecret,
        postgresPassword: provisioned.postgresPassword,
        postgresContainerHost: provisioned.postgres.containerName,
        note:
          "PGRST_JWT_SECRET is the HS256 key PostgREST uses for JWT verification. postgresPassword is the tenant superuser; postgresContainerHost is Docker DNS on the tenant bridge (not a public host). With FLUX_DEV_POSTGRES_PASSWORD set, the DB password is derived from the volume name.",
      },
      cleanupOnFailure: async () =>
        input.projectManager
          .nukeContainersOnly(provisioned.slug, provisioned.hash)
          .catch(() => undefined),
    };
  }

  const slug = slugifyProjectName(input.projectName);
  const projectJwtSecret = generateProjectJwtSecret();
  const provisionSharedTenant =
    input.provisionSharedTenant ??
    (async (tenantId: string) => {
      const v2 = getEngineV2();
      return v2.provisionProject({ tenantId });
    });
  const doDeprovision =
    input.deprovisionSharedTenant ??
    (async (tenantId: string) => deprovisionProject(tenantId));
  const tenant = await provisionSharedTenant(input.tenantId);
  return {
    mode: "v2_shared",
    name: input.projectName,
    slug,
    hash: input.projectHash,
    apiUrl: fluxApiUrlForSlug(slug, input.projectHash, input.isProduction),
    stripSupabaseRestPrefix: true,
    tenant,
    projectJwtSecret,
    secrets: {
      pgrstJwtSecret: projectJwtSecret,
      postgresPassword: "n/a-v2-shared",
      postgresContainerHost: "shared-cluster",
      note:
        "PROJECT_JWT_SECRET (jwt_secret) signs tenant-issued JWTs; the gateway verifies them per Host. " +
        "Gateway→PostgREST uses the pool FLUX_GATEWAY_JWT_SECRET / PGRST_JWT_SECRET (not this value).",
    },
    // Rollback: if the catalog INSERT fails after provisioning succeeds, drop the
    // just-created schema + role from the shared cluster so they don't accumulate
    // as orphans.  Errors here are logged but not re-thrown — the caller already
    // has a failure to report and we must not mask it with a secondary one.
    cleanupOnFailure: async () => {
      try {
        await doDeprovision(input.tenantId);
      } catch (cleanupErr: unknown) {
        console.error(
          `[engine-v2] cleanupOnFailure: failed to deprovision tenant "${input.tenantId}" after catalog insert failure:`,
          cleanupErr,
        );
      }
    },
  };
}
