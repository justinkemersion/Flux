import { and, eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { projects } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";
import { getProjectManager } from "@/src/lib/flux";

export type ProjectPowerAction = "start" | "stop";

type ProjectRow = InferSelectModel<typeof projects>;

async function applyProjectPowerForRow(
  project: ProjectRow,
  action: ProjectPowerAction,
): Promise<{ ok: true } | { error: string; status: number }> {
  const db = getDb();
  const pm = getProjectManager();
  try {
    if (action === "start") {
      await pm.startProjectInfrastructure(project.slug, project.hash);
      await db
        .update(projects)
        .set({ healthStatus: "running" })
        .where(eq(projects.id, project.id));
    } else {
      await pm.stopProject(project.slug, project.hash);
      await db
        .update(projects)
        .set({ healthStatus: null })
        .where(eq(projects.id, project.id));
    }
  } catch (err: unknown) {
    return {
      error: err instanceof Error ? err.message : String(err),
      status: 500,
    };
  }
  return { ok: true };
}

/**
 * Session- or admin power: start/stop Docker stack and sync catalog health.
 */
export async function applyProjectPowerAction(input: {
  slug: string;
  userId: string;
  action: ProjectPowerAction;
}): Promise<{ ok: true } | { error: string; status: number }> {
  await initSystemDb();
  const db = getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(eq(projects.slug, input.slug), eq(projects.userId, input.userId)),
    );
  if (!project) {
    return { error: "Project not found", status: 404 };
  }
  return applyProjectPowerForRow(project, input.action);
}

/**
 * CLI: resolve project by owner + hash, then run the same power action.
 */
export async function applyProjectPowerActionByHash(input: {
  hash: string;
  userId: string;
  action: ProjectPowerAction;
}): Promise<{ ok: true } | { error: string; status: number }> {
  await initSystemDb();
  const db = getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(eq(projects.userId, input.userId), eq(projects.hash, input.hash)),
    );
  if (!project) {
    return { error: "Project not found", status: 404 };
  }
  return applyProjectPowerForRow(project, input.action);
}
