import { randomBytes } from "node:crypto";
import {
  dbAccessReadwriteEnabled,
  normalizeDbAccessTtlSeconds,
  type DbAccessLevel,
} from "@flux/core";
import { provisionTemporaryDbAccessCredential } from "@flux/engine-v2";
import {
  getProjectDbAccessPlan,
  isProjectOwnerOrAdmin,
  type ProjectDbAccessRow,
} from "./project-db-access.ts";

export type TemporaryDbCredential = {
  username: string;
  password: string;
  access: DbAccessLevel;
  expiresAt: string;
  tenantSchema: string;
  searchPath: string[];
};

export type CreateProjectDbTempCredentialInput = {
  hash: string;
  actorUserId: string;
  actorEmail?: string | null;
  actorName?: string | null;
  access?: DbAccessLevel;
  ttlSeconds?: number;
};

export type CreateProjectDbTempCredentialDeps = {
  findOwnedProject: (
    hash: string,
    userId: string,
  ) => Promise<ProjectDbAccessRow | null>;
  insertAuditEvent: (event: {
    projectId: string;
    userId: string;
    hash: string;
    mode: "v2_shared";
    access: DbAccessLevel;
    ttlSeconds: number;
    username: string;
    expiresAt: Date;
  }) => Promise<void>;
  insertTempCredential: (row: {
    projectId: string;
    userId: string;
    username: string;
    access: DbAccessLevel;
    expiresAt: Date;
  }) => Promise<void>;
  provisionRole?: typeof provisionTemporaryDbAccessCredential;
};

export type CreateProjectDbTempCredentialResult =
  | { ok: true; credential: TemporaryDbCredential }
  | { ok: false; status: number; error: string };

function generateTempDbPassword(): string {
  return randomBytes(24).toString("base64url");
}

function generateTempRoleSuffix(): string {
  return randomBytes(4).toString("hex");
}

export async function createProjectDbTempCredential(
  input: CreateProjectDbTempCredentialInput,
  deps: CreateProjectDbTempCredentialDeps,
): Promise<CreateProjectDbTempCredentialResult> {
  const access = input.access ?? "readonly";
  if (access === "readwrite" && !dbAccessReadwriteEnabled()) {
    return {
      ok: false,
      status: 403,
      error:
        "Read/write database access is disabled on this platform. Use readonly access or ask an operator to enable FLUX_DB_ACCESS_ALLOW_READWRITE.",
    };
  }

  let ttlSeconds: number;
  try {
    ttlSeconds = normalizeDbAccessTtlSeconds({
      access,
      ttlSeconds: input.ttlSeconds,
    });
  } catch (err) {
    return {
      ok: false,
      status: 400,
      error: err instanceof Error ? err.message : "Invalid ttlSeconds.",
    };
  }

  const planResult = await getProjectDbAccessPlan(
    {
      hash: input.hash,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      actorName: input.actorName,
    },
    {
      findOwnedProject: deps.findOwnedProject,
    },
  );
  if (!planResult.ok) {
    return planResult;
  }
  const plan = planResult.plan;
  if (plan.mode !== "v2_shared") {
    return {
      ok: false,
      status: 400,
      error: "Temporary database credentials are only available for v2_shared projects.",
    };
  }
  if (!plan.capabilities.temporaryCredentials) {
    return {
      ok: false,
      status: 400,
      error: "Temporary database credentials are not enabled for this project.",
    };
  }
  if (access === "readwrite" && !plan.capabilities.readwrite) {
    return {
      ok: false,
      status: 403,
      error: "Read/write database access is not enabled for this project.",
    };
  }

  const project = await deps.findOwnedProject(
    input.hash.trim().toLowerCase(),
    input.actorUserId,
  );
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

  const password = generateTempDbPassword();
  const suffix = generateTempRoleSuffix();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const provision = deps.provisionRole ?? provisionTemporaryDbAccessCredential;

  try {
    const { username } = await provision({
      projectHash: project.hash,
      projectId: project.id,
      tenantSchema: plan.tenantSchema,
      access,
      password,
      suffix,
      expiresAt,
    });
    await deps.insertTempCredential({
      projectId: project.id,
      userId: input.actorUserId,
      username,
      access,
      expiresAt,
    });
    await deps.insertAuditEvent({
      projectId: project.id,
      userId: input.actorUserId,
      hash: project.hash,
      mode: "v2_shared",
      access,
      ttlSeconds,
      username,
      expiresAt,
    });

    return {
      ok: true,
      credential: {
        username,
        password,
        access,
        expiresAt: expiresAt.toISOString(),
        tenantSchema: plan.tenantSchema,
        searchPath: plan.database.searchPath,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 500,
      error: `Failed to create temporary database credential: ${message}`,
    };
  }
}

export function logDbTempCredentialAudit(event: {
  event: "db_temp_credential_created";
  userId: string;
  hash: string;
  mode: "v2_shared";
  access: DbAccessLevel;
  ttlSeconds: number;
  username: string;
  expiresAt: string;
}): void {
  console.info(
    JSON.stringify({
      ...event,
      at: new Date().toISOString(),
    }),
  );
}
