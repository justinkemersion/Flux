import { and, eq } from "drizzle-orm";
import {
  normalizeFluxMdContent,
  type FluxMdSnapshot,
  FluxMdValidationError,
} from "@flux/core/flux-md";
import { projects } from "@/src/db/schema";
import type { SystemDb } from "@/src/lib/db";

export type ProjectFluxMdRow = FluxMdSnapshot & {
  slug: string;
  hash: string;
  name: string;
};

function rowToSnapshot(row: {
  fluxMd: string | null;
  fluxMdSyncedAt: Date | null;
}): FluxMdSnapshot {
  return {
    content: row.fluxMd ?? null,
    syncedAt: row.fluxMdSyncedAt?.toISOString() ?? null,
  };
}

export async function getProjectFluxMdById(
  db: SystemDb,
  projectId: string,
): Promise<ProjectFluxMdRow | null> {
  const [row] = await db
    .select({
      slug: projects.slug,
      hash: projects.hash,
      name: projects.name,
      fluxMd: projects.fluxMd,
      fluxMdSyncedAt: projects.fluxMdSyncedAt,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!row) return null;
  return {
    slug: row.slug,
    hash: row.hash,
    name: row.name,
    ...rowToSnapshot(row),
  };
}

export async function syncProjectFluxMd(
  db: SystemDb,
  projectId: string,
  content: string | null,
): Promise<ProjectFluxMdRow> {
  let normalized: string | null;
  try {
    normalized = normalizeFluxMdContent(content);
  } catch (err: unknown) {
    if (err instanceof FluxMdValidationError) throw err;
    throw err;
  }

  const syncedAt = normalized ? new Date() : null;
  await db
    .update(projects)
    .set({
      fluxMd: normalized,
      fluxMdSyncedAt: syncedAt,
    })
    .where(eq(projects.id, projectId));

  const updated = await getProjectFluxMdById(db, projectId);
  if (!updated) throw new Error("Project not found after update");
  return updated;
}

export async function loadOwnedProjectFluxMd(
  db: SystemDb,
  input: { slug: string; hash: string; userId: string },
): Promise<ProjectFluxMdRow | null> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.slug, input.slug),
        eq(projects.hash, input.hash),
        eq(projects.userId, input.userId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return getProjectFluxMdById(db, row.id);
}

export async function syncOwnedProjectFluxMd(
  db: SystemDb,
  input: { slug: string; hash: string; userId: string },
  content: string | null,
): Promise<ProjectFluxMdRow> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.slug, input.slug),
        eq(projects.hash, input.hash),
        eq(projects.userId, input.userId),
      ),
    )
    .limit(1);
  if (!row) throw new Error("Project not found");
  return syncProjectFluxMd(db, row.id, content);
}
