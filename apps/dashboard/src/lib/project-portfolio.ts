import { inArray, max } from "drizzle-orm";
import { projectActivityEvents } from "@/src/db/schema";
import type { SystemDb } from "@/src/lib/db";

/** Latest activity timestamp per project id (ISO string). */
export async function loadLastActivityByProjectIds(
  db: SystemDb,
  projectIds: readonly string[],
): Promise<Map<string, string>> {
  if (projectIds.length === 0) return new Map();

  const rows = await db
    .select({
      projectId: projectActivityEvents.projectId,
      lastAt: max(projectActivityEvents.createdAt),
    })
    .from(projectActivityEvents)
    .where(inArray(projectActivityEvents.projectId, [...projectIds]))
    .groupBy(projectActivityEvents.projectId);

  const out = new Map<string, string>();
  for (const row of rows) {
    if (row.lastAt instanceof Date) {
      out.set(row.projectId, row.lastAt.toISOString());
    }
  }
  return out;
}
