import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/src/lib/auth";
import { projects } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";
import { getProjectManager } from "@/src/lib/flux";
import { assertDestructiveBackupAllowed } from "@/src/lib/destructive-backup-gate";
import { runDashboardFactoryReset } from "@/src/lib/destructive-project-routes";
import { dispatchProvisionProject } from "@/src/lib/provisioning-engine";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * POST /api/projects/[slug]/factory-reset
 * Destructive reset for v1 dedicated projects: removes API/DB containers + data volume,
 * then reprovisions an empty stack for the same slug/hash.
 */
export async function POST(
  req: NextRequest,
  ctx: Ctx,
): Promise<Response> {
  return runDashboardFactoryReset(req, ctx, {
    initSystemDb,
    auth: async () => {
      const session = await auth();
      return session?.user?.id ? { userId: session.user.id } : null;
    },
    loadOwnedProject: async (slug, userId) => {
      const db = getDb();
      const [project] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.slug, slug), eq(projects.userId, userId)));
      if (!project) return null;
      return {
        id: project.id,
        slug: project.slug,
        hash: project.hash,
        name: project.name,
        mode: project.mode,
      };
    },
    assertDestructiveBackupAllowed,
    factoryResetProject: async (project) => {
      const pm = getProjectManager();
      await pm.nukeContainersOnly(project.slug, project.hash);
      await pm.removeTenantPrivateNetworkAllowMissing(project.slug, project.hash);
      const provisioned = await dispatchProvisionProject({
        mode: project.mode,
        projectName: project.name,
        projectHash: project.hash,
        tenantId: project.id,
        projectManager: pm,
        isProduction: process.env.NODE_ENV === "production",
      });
      const db = getDb();
      await db
        .update(projects)
        .set({ jwtSecret: provisioned.projectJwtSecret })
        .where(eq(projects.id, project.id));
      return {
        apiUrl: provisioned.apiUrl,
        slug: provisioned.slug,
        mode: "v1_dedicated" as const,
      };
    },
  });
}
