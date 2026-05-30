import type { NextRequest } from "next/server";
import {
  FLUX_PROJECT_HASH_HEX_LEN,
  slugifyProjectName,
  type DeleteProjectInfrastructureResult,
} from "@flux/core";
import type { MigrateCliPayload } from "@flux/migrate";
import type { BackupTrustClassification } from "@flux/core/backup-trust";
import {
  destructiveBackupGateOrThrow,
  parseSkipBackupCheckParam,
} from "@/src/lib/destructive-backup-gate";

export type DestructiveProjectRow = {
  id: string;
  slug: string;
  hash: string;
  name: string;
  mode: "v1_dedicated" | "v2_shared";
};

export type DashboardSessionAuth = {
  userId: string;
} | null;

export type CliKeyAuth = {
  userId: string;
} | null;

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function isValidHash(h: string): boolean {
  return (
    h.length === FLUX_PROJECT_HASH_HEX_LEN && /^[a-f0-9]+$/u.test(h)
  );
}

export type DashboardProjectDeleteDeps = {
  initSystemDb: () => Promise<void>;
  auth: () => Promise<DashboardSessionAuth>;
  resolveOwnedProject: (
    slug: string,
    userId: string,
  ) => Promise<DestructiveProjectRow | null>;
  assertDestructiveBackupAllowed: (
    projectId: string,
    options?: { skipBackupCheck?: boolean },
  ) => Promise<BackupTrustClassification>;
  listProjectHostnames: (project: DestructiveProjectRow) => Promise<string[]>;
  evictHostnames: (hostnames: string[]) => Promise<void>;
  deleteProjectInfrastructure: (project: DestructiveProjectRow) => Promise<void>;
  deleteCatalogRow: (projectId: string) => Promise<void>;
};

export async function runDashboardProjectDelete(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
  deps: DashboardProjectDeleteDeps,
): Promise<Response> {
  const session = await deps.auth();
  if (!session?.userId) return jsonError("Unauthorized", 401);

  const { slug } = await ctx.params;
  const skipBackupCheck = parseSkipBackupCheckParam(
    req.nextUrl.searchParams.get("skipBackupCheck"),
  );

  await deps.initSystemDb();
  const project = await deps.resolveOwnedProject(slug, session.userId);
  if (!project) return jsonError("Project not found", 404);

  try {
    await deps.assertDestructiveBackupAllowed(project.id, { skipBackupCheck });
  } catch (err: unknown) {
    const blocked = destructiveBackupGateOrThrow(err);
    if (blocked) return blocked;
    throw err;
  }

  try {
    const hostnames = await deps.listProjectHostnames(project);
    await deps.evictHostnames(hostnames);
    await deps.deleteProjectInfrastructure(project);
    await deps.deleteCatalogRow(project.id);
    return Response.json({ ok: true });
  } catch (err: unknown) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

export type DashboardFactoryResetDeps = {
  initSystemDb: () => Promise<void>;
  auth: () => Promise<DashboardSessionAuth>;
  loadOwnedProject: (
    slug: string,
    userId: string,
  ) => Promise<DestructiveProjectRow | null>;
  assertDestructiveBackupAllowed: (
    projectId: string,
    options?: { skipBackupCheck?: boolean },
  ) => Promise<BackupTrustClassification>;
  factoryResetProject: (project: DestructiveProjectRow) => Promise<{
    apiUrl: string;
    slug: string;
    mode: "v1_dedicated";
  }>;
};

export async function runDashboardFactoryReset(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
  deps: DashboardFactoryResetDeps,
): Promise<Response> {
  const session = await deps.auth();
  if (!session?.userId) return jsonError("Unauthorized", 401);

  const { slug } = await ctx.params;

  await deps.initSystemDb();
  const project = await deps.loadOwnedProject(slug, session.userId);
  if (!project) return jsonError("Project not found", 404);
  if (project.mode !== "v1_dedicated") {
    return jsonError(
      "Factory reset is only supported for v1_dedicated projects.",
      400,
    );
  }

  const skipBackupCheck = parseSkipBackupCheckParam(
    req.nextUrl.searchParams.get("skipBackupCheck"),
  );
  try {
    await deps.assertDestructiveBackupAllowed(project.id, { skipBackupCheck });
  } catch (err: unknown) {
    const blocked = destructiveBackupGateOrThrow(err);
    if (blocked) return blocked;
    throw err;
  }

  try {
    const result = await deps.factoryResetProject(project);
    return Response.json({ ok: true, ...result });
  } catch (err: unknown) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

export type CliMigratePostDeps = {
  initSystemDb: () => Promise<void>;
  authenticateCli: (authorizationHeader: string | null) => Promise<CliKeyAuth>;
  findOwnedProjectId: (input: {
    userId: string;
    slug: string;
    hash: string;
  }) => Promise<string | null>;
  assertDestructiveBackupAllowed: (
    projectId: string,
  ) => Promise<BackupTrustClassification>;
  runMigration: (input: {
    userId: string;
    payload: MigrateCliPayload;
  }) => Promise<{ ok: boolean; [key: string]: unknown }>;
};

export async function runCliMigratePost(
  req: Request,
  deps: CliMigratePostDeps,
): Promise<Response> {
  await deps.initSystemDb();
  const auth = await deps.authenticateCli(req.headers.get("authorization"));
  if (!auth?.userId) return jsonError("Unauthorized", 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("slug" in body) ||
    !("hash" in body) ||
    typeof (body as { slug: unknown }).slug !== "string" ||
    typeof (body as { hash: unknown }).hash !== "string"
  ) {
    return jsonError('Expected JSON body with string "slug" and "hash" fields', 400);
  }

  const payload = body as MigrateCliPayload;

  if (!payload.dryRun && !payload.skipBackupCheck) {
    const projectId = await deps.findOwnedProjectId({
      userId: auth.userId,
      slug: payload.slug.trim(),
      hash: payload.hash.trim().toLowerCase(),
    });
    if (!projectId) {
      return jsonError("Project not found for this API key", 404);
    }
    try {
      await deps.assertDestructiveBackupAllowed(projectId);
    } catch (err: unknown) {
      const blocked = destructiveBackupGateOrThrow(err);
      if (blocked) return blocked;
      throw err;
    }
  }

  try {
    const result = await deps.runMigration({ userId: auth.userId, payload });
    if (!result.ok) {
      return Response.json(result, {
        status: 400,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(`Migration failed: ${message}`, 500);
  }
}

export type CliProjectDeleteDeps = {
  initSystemDb: () => Promise<void>;
  authenticateCli: (authorizationHeader: string | null) => Promise<CliKeyAuth>;
  findOwnedProjectByHash: (
    userId: string,
    hash: string,
  ) => Promise<DestructiveProjectRow | null>;
  assertDestructiveBackupAllowed: (
    projectId: string,
  ) => Promise<BackupTrustClassification>;
  deleteProjectInfrastructure: (
    slug: string,
    hash: string,
  ) => Promise<DeleteProjectInfrastructureResult>;
  deleteCatalogRow: (projectId: string) => Promise<void>;
  deleteOrphanInfrastructure: (
    slug: string,
    hash: string,
  ) => Promise<DeleteProjectInfrastructureResult>;
};

export async function runCliProjectDelete(
  req: Request,
  ctx: { params: Promise<{ hash: string }> },
  deps: CliProjectDeleteDeps,
): Promise<Response> {
  await deps.initSystemDb();
  const auth = await deps.authenticateCli(req.headers.get("authorization"));
  if (!auth?.userId) return jsonError("Unauthorized", 401);

  const { hash: paramHash } = await ctx.params;
  const hash = (paramHash ?? "").trim().toLowerCase();
  if (!isValidHash(hash)) {
    return jsonError(
      `hash in path must be a ${String(FLUX_PROJECT_HASH_HEX_LEN)}-char hex id`,
      400,
    );
  }

  const u = new URL(req.url);
  const force =
    u.searchParams.get("force") === "1" || u.searchParams.get("force") === "true";
  const forceSlugParam = (u.searchParams.get("slug") ?? "").trim();
  const skipBackupCheck = parseSkipBackupCheckParam(
    u.searchParams.get("skipBackupCheck"),
  );

  const row = await deps.findOwnedProjectByHash(auth.userId, hash);

  if (row) {
    try {
      if (!skipBackupCheck) {
        try {
          await deps.assertDestructiveBackupAllowed(row.id);
        } catch (err: unknown) {
          const blocked = destructiveBackupGateOrThrow(err);
          if (blocked) return blocked;
          throw err;
        }
      }
      const result = await deps.deleteProjectInfrastructure(row.slug, row.hash);
      await deps.deleteCatalogRow(row.id);
      return Response.json({
        ok: true,
        mode: "catalog" as const,
        hash: row.hash,
        removed: result.removed,
      });
    } catch (err: unknown) {
      return jsonError(err instanceof Error ? err.message : String(err), 500);
    }
  }

  if (force) {
    if (!forceSlugParam) {
      return jsonError(
        "No catalog row for this hash. Re-run with ?force=1&slug=<project-slug> (e.g. from flux.json) to remove orphaned containers and volume only.",
        400,
      );
    }
    let slug: string;
    try {
      slug = slugifyProjectName(forceSlugParam);
    } catch (err: unknown) {
      return jsonError(
        err instanceof Error ? err.message : "Invalid slug query parameter",
        400,
      );
    }
    try {
      const result = await deps.deleteOrphanInfrastructure(slug, hash);
      return Response.json({
        ok: true,
        mode: "orphan" as const,
        hash,
        slug,
        removed: result.removed,
      });
    } catch (err: unknown) {
      return jsonError(err instanceof Error ? err.message : String(err), 500);
    }
  }

  return jsonError(
    "No project in your catalog for this hash. If Docker resources remain without a row, use ?force=1&slug=<name>.",
    404,
  );
}
