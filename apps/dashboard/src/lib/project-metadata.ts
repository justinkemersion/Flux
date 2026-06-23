import { and, eq } from "drizzle-orm";
import {
  mergeProjectMetadata,
  type ProjectMetadataFields,
  type ProjectMetadataPatch,
  ProjectMetadataValidationError,
} from "@flux/core/project-metadata";
import { projects } from "@/src/db/schema";
import type { SystemDb } from "@/src/lib/db";

export type ProjectMetadataRow = ProjectMetadataFields & {
  slug: string;
  hash: string;
  name: string;
  updatedAt: string;
};

function rowToFields(row: {
  description: string | null;
  brief: string | null;
}): ProjectMetadataFields {
  return {
    description: row.description ?? null,
    brief: row.brief ?? null,
  };
}

export async function getProjectMetadataById(
  db: SystemDb,
  projectId: string,
): Promise<ProjectMetadataRow | null> {
  const [row] = await db
    .select({
      slug: projects.slug,
      hash: projects.hash,
      name: projects.name,
      description: projects.description,
      brief: projects.brief,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!row) return null;
  return {
    slug: row.slug,
    hash: row.hash,
    name: row.name,
    ...rowToFields(row),
    updatedAt: new Date().toISOString(),
  };
}

export async function updateProjectMetadata(
  db: SystemDb,
  projectId: string,
  patch: ProjectMetadataPatch,
): Promise<ProjectMetadataRow> {
  const [existing] = await db
    .select({
      description: projects.description,
      brief: projects.brief,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!existing) {
    throw new Error("Project not found");
  }

  let merged: ProjectMetadataFields;
  try {
    merged = mergeProjectMetadata(rowToFields(existing), patch);
  } catch (err: unknown) {
    if (err instanceof ProjectMetadataValidationError) {
      throw err;
    }
    throw err;
  }

  await db
    .update(projects)
    .set({
      description: merged.description,
      brief: merged.brief,
    })
    .where(eq(projects.id, projectId));

  const updated = await getProjectMetadataById(db, projectId);
  if (!updated) throw new Error("Project not found after update");
  return updated;
}

export async function loadOwnedProjectMetadata(
  db: SystemDb,
  input: { slug: string; hash: string; userId: string },
): Promise<ProjectMetadataRow | null> {
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
  return getProjectMetadataById(db, row.id);
}

export async function patchOwnedProjectMetadata(
  db: SystemDb,
  input: { slug: string; hash: string; userId: string },
  patch: ProjectMetadataPatch,
): Promise<ProjectMetadataRow> {
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
  return updateProjectMetadata(db, row.id, patch);
}
