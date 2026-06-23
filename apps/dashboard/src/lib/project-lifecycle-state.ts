import { and, count, eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
  activeProjectLimitForPlan,
  assertWithinActiveProjectLimit,
  lifecycleStateForAction,
  lifecycleStateLabel,
  lifecycleStateSummary,
  normalizeProjectLifecycleState,
  type ProjectLifecycleAction,
  type ProjectLifecycleState,
} from "@flux/core/project-lifecycle-state";
import {
  lifecycleArchiveSummary,
  lifecycleSleepSummary,
  lifecycleWakeSummary,
} from "@flux/core/project-activity";
import { projects, users } from "@/src/db/schema";
import type { SystemDb } from "@/src/lib/db";
import {
  evictHostnames,
  v2SharedGatewayCacheHostnames,
} from "@/src/lib/gateway-cache";
import {
  applyProjectPowerForRow,
  type ProjectPowerAction,
} from "@/src/lib/project-lifecycle";
import { tryRecordProjectActivity } from "@/src/lib/project-activity";
import { loadUserUnlimitedProjects } from "@/src/lib/cli-project-provision";

type ProjectRow = InferSelectModel<typeof projects>;

export type ProjectLifecycleInfo = {
  slug: string;
  hash: string;
  name: string;
  lifecycleState: ProjectLifecycleState;
  summary: string;
  activeCount: number;
  activeLimit: number;
  plan: "hobby" | "pro";
};

function gatewayHostnamesForProject(project: ProjectRow): string[] {
  const isProduction = process.env.NODE_ENV === "production";
  return v2SharedGatewayCacheHostnames(
    project.slug,
    project.hash,
    isProduction,
  );
}

async function loadUserPlan(
  db: SystemDb,
  userId: string,
): Promise<"hobby" | "pro"> {
  const [userRow] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return userRow?.plan === "pro" ? "pro" : "hobby";
}

export async function countUserActiveProjects(
  db: SystemDb,
  userId: string,
): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(projects)
    .where(
      and(eq(projects.userId, userId), eq(projects.lifecycleState, "active")),
    );
  return n;
}

export async function getProjectLifecycleInfo(
  db: SystemDb,
  projectId: string,
  userId: string,
): Promise<ProjectLifecycleInfo | null> {
  const [row] = await db
    .select({
      slug: projects.slug,
      hash: projects.hash,
      name: projects.name,
      lifecycleState: projects.lifecycleState,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  if (!row) return null;

  const plan = await loadUserPlan(db, userId);
  const activeCount = await countUserActiveProjects(db, userId);
  const lifecycleState = normalizeProjectLifecycleState(row.lifecycleState);

  return {
    slug: row.slug,
    hash: row.hash,
    name: row.name,
    lifecycleState,
    summary: lifecycleStateSummary(lifecycleState),
    activeCount,
    activeLimit: activeProjectLimitForPlan(plan),
    plan,
  };
}

function activityForTransition(
  action: ProjectLifecycleAction,
): { kind: "lifecycle.wake" | "lifecycle.sleep" | "lifecycle.archive"; summary: string } {
  if (action === "wake") {
    return { kind: "lifecycle.wake", summary: lifecycleWakeSummary() };
  }
  if (action === "sleep") {
    return { kind: "lifecycle.sleep", summary: lifecycleSleepSummary() };
  }
  return { kind: "lifecycle.archive", summary: lifecycleArchiveSummary() };
}

function powerActionForLifecycle(
  from: ProjectLifecycleState,
  to: ProjectLifecycleState,
): ProjectPowerAction | null {
  if (from === to) return null;
  if (to === "active") return "start";
  if (to === "dormant" || to === "archived") return "stop";
  return null;
}

export async function applyProjectLifecycleActionForRow(
  db: SystemDb,
  project: ProjectRow,
  userId: string,
  action: ProjectLifecycleAction,
): Promise<
  | { ok: true; lifecycleState: ProjectLifecycleState; noop?: boolean }
  | { error: string; status: number }
> {
  const from = normalizeProjectLifecycleState(project.lifecycleState);
  const to = lifecycleStateForAction(action);

  if (action === "wake" && from !== "active") {
    const plan = await loadUserPlan(db, userId);
    const unlimited = await loadUserUnlimitedProjects(db, userId);
    const activeCount = await countUserActiveProjects(db, userId);
    const limitCheck = assertWithinActiveProjectLimit(plan, activeCount, {
      unlimited,
    });
    if (!limitCheck.ok) {
      return { error: limitCheck.message, status: 403 };
    }
  }

  if (from === to) {
    return { ok: true, lifecycleState: to, noop: true };
  }

  const power = powerActionForLifecycle(from, to);
  if (power) {
    const powerResult = await applyProjectPowerForRow(project, power);
    if ("error" in powerResult) {
      return powerResult;
    }
  }

  await db
    .update(projects)
    .set({ lifecycleState: to })
    .where(eq(projects.id, project.id));

  await evictHostnames(gatewayHostnamesForProject(project));

  const activity = activityForTransition(action);
  await tryRecordProjectActivity(db, {
    projectId: project.id,
    userId,
    kind: activity.kind,
    summary: activity.summary,
    metadata: {
      from,
      to,
      label: lifecycleStateLabel(to),
    },
  });

  return { ok: true, lifecycleState: to };
}

export async function applyProjectLifecycleAction(input: {
  db: SystemDb;
  slug: string;
  userId: string;
  action: ProjectLifecycleAction;
}): Promise<
  | { ok: true; lifecycleState: ProjectLifecycleState; noop?: boolean }
  | { error: string; status: number }
> {
  const [project] = await input.db
    .select()
    .from(projects)
    .where(
      and(eq(projects.slug, input.slug), eq(projects.userId, input.userId)),
    )
    .limit(1);
  if (!project) {
    return { error: "Project not found", status: 404 };
  }
  return applyProjectLifecycleActionForRow(
    input.db,
    project,
    input.userId,
    input.action,
  );
}

export async function applyProjectLifecycleActionByHash(input: {
  db: SystemDb;
  hash: string;
  userId: string;
  action: ProjectLifecycleAction;
}): Promise<
  | { ok: true; lifecycleState: ProjectLifecycleState; noop?: boolean }
  | { error: string; status: number }
> {
  const [project] = await input.db
    .select()
    .from(projects)
    .where(
      and(eq(projects.userId, input.userId), eq(projects.hash, input.hash)),
    )
    .limit(1);
  if (!project) {
    return { error: "Project not found", status: 404 };
  }
  return applyProjectLifecycleActionForRow(
    input.db,
    project,
    input.userId,
    input.action,
  );
}

export async function loadOwnedProjectLifecycle(
  db: SystemDb,
  input: { slug: string; hash: string; userId: string },
): Promise<ProjectLifecycleInfo | null> {
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
  return getProjectLifecycleInfo(db, row.id, input.userId);
}

export async function loadProjectLifecycleByHash(
  db: SystemDb,
  input: { hash: string; userId: string },
): Promise<ProjectLifecycleInfo | null> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(eq(projects.hash, input.hash), eq(projects.userId, input.userId)),
    )
    .limit(1);
  if (!row) return null;
  return getProjectLifecycleInfo(db, row.id, input.userId);
}

/** Count lifecycle buckets for fleet summary (excludes other users). */
export async function countLifecycleBucketsForUser(
  db: SystemDb,
  userId: string,
): Promise<{ active: number; dormant: number; archived: number }> {
  const rows = await db
    .select({
      lifecycleState: projects.lifecycleState,
      n: count(),
    })
    .from(projects)
    .where(eq(projects.userId, userId))
    .groupBy(projects.lifecycleState);

  const out = { active: 0, dormant: 0, archived: 0 };
  for (const row of rows) {
    const state = normalizeProjectLifecycleState(row.lifecycleState);
    out[state] = row.n;
  }
  return out;
}
