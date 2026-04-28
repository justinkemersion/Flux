import { fluxApiUrlForSlug, slugifyProjectName } from "@flux/core";
import type { ProjectManager } from "@flux/core";
import { getEngineV2 } from "@/src/lib/flux";

export type ProjectMode = "v1_dedicated" | "v2_shared";

export type DispatchProvisionInput = {
  mode: ProjectMode;
  projectName: string;
  projectHash: string;
  tenantId: string;
  projectManager: ProjectManager;
  isProduction: boolean;
  customJwtSecret?: string;
  stripSupabaseRestPrefix?: boolean;
  provisionSharedTenant?: (
    tenantId: string,
  ) => Promise<{ tenantId: string; shortId: string; schema: string; role: string }>;
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
 * v1 path keeps existing Docker-per-tenant provisioning.
 * v2 path only performs shared-cluster bootstrap in engine-v2.
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
  const provisionSharedTenant =
    input.provisionSharedTenant ??
    (async (tenantId: string) => {
      const v2 = getEngineV2();
      return v2.provisionProject({ tenantId });
    });
  const tenant = await provisionSharedTenant(input.tenantId);
  return {
    mode: "v2_shared",
    name: input.projectName,
    slug,
    hash: input.projectHash,
    apiUrl: fluxApiUrlForSlug(slug, input.projectHash, input.isProduction),
    stripSupabaseRestPrefix: true,
    tenant,
    // CLI response still expects `secrets`; for v2 these are intentionally non-applicable.
    secrets: {
      pgrstJwtSecret: "managed-by-gateway-shared-secret",
      postgresPassword: "n/a-v2-shared",
      postgresContainerHost: "shared-cluster",
      note:
        "v2_shared uses shared-cluster provisioning. Runtime JWT verification is configured on the pooled PostgREST deployment and must share FLUX_GATEWAY_JWT_SECRET/PGRST_JWT_SECRET.",
    },
    cleanupOnFailure: async () => Promise.resolve(),
  };
}
