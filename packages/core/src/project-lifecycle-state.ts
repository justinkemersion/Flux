/**
 * Product-level project lifecycle — Active, Dormant, Archived.
 * Distinct from Docker start/stop and idle reaper (`last_accessed_at`).
 */

export const PROJECT_LIFECYCLE_STATES = [
  "active",
  "dormant",
  "archived",
] as const;

export type ProjectLifecycleState = (typeof PROJECT_LIFECYCLE_STATES)[number];

export const PROJECT_LIFECYCLE_ACTIONS = [
  "wake",
  "sleep",
  "archive",
] as const;

export type ProjectLifecycleAction = (typeof PROJECT_LIFECYCLE_ACTIONS)[number];

export const HOBBY_ACTIVE_PROJECT_LIMIT = 2;
export const PRO_ACTIVE_PROJECT_LIMIT = 10;

export const HOBBY_ACTIVE_LIMIT_ERROR =
  "Active project limit reached (2 on Hobby). Put another project to sleep or upgrade to Pro.";
export const PRO_ACTIVE_LIMIT_ERROR =
  "Active project limit reached (10 on Pro). Put another project to sleep.";

export type UserPlan = "hobby" | "pro";

const ACTION_TARGET: Record<
  ProjectLifecycleAction,
  ProjectLifecycleState
> = {
  wake: "active",
  sleep: "dormant",
  archive: "archived",
};

export function lifecycleStateForAction(
  action: ProjectLifecycleAction,
): ProjectLifecycleState {
  return ACTION_TARGET[action];
}

export function isProjectLifecycleState(
  value: string | null | undefined,
): value is ProjectLifecycleState {
  return (
    value === "active" ||
    value === "dormant" ||
    value === "archived"
  );
}

/** Default for legacy rows before the column existed. */
export function normalizeProjectLifecycleState(
  value: string | null | undefined,
): ProjectLifecycleState {
  return isProjectLifecycleState(value) ? value : "active";
}

export function lifecycleStateLabel(state: ProjectLifecycleState): string {
  if (state === "active") return "Active";
  if (state === "dormant") return "Dormant";
  return "Archived";
}

export function lifecycleActionLabel(action: ProjectLifecycleAction): string {
  if (action === "wake") return "Wake project";
  if (action === "sleep") return "Put project to sleep";
  return "Archive project";
}

export function lifecycleStateSummary(state: ProjectLifecycleState): string {
  if (state === "active") {
    return "API traffic allowed; counts toward your active project limit.";
  }
  if (state === "dormant") {
    return "Data retained; tenant API paused. Dashboard inspection and backups remain available.";
  }
  return "Frozen for long-term retention; tenant API paused. Wake to resume traffic.";
}

export function assertWithinActiveProjectLimit(
  plan: UserPlan,
  activeCount: number,
  options?: { unlimited?: boolean },
): { ok: true } | { ok: false; message: string } {
  if (options?.unlimited) return { ok: true };
  const cap =
    plan === "pro" ? PRO_ACTIVE_PROJECT_LIMIT : HOBBY_ACTIVE_PROJECT_LIMIT;
  if (activeCount >= cap) {
    return {
      ok: false,
      message:
        plan === "pro" ? PRO_ACTIVE_LIMIT_ERROR : HOBBY_ACTIVE_LIMIT_ERROR,
    };
  }
  return { ok: true };
}

export function activeProjectLimitForPlan(plan: UserPlan): number {
  return plan === "pro" ? PRO_ACTIVE_PROJECT_LIMIT : HOBBY_ACTIVE_PROJECT_LIMIT;
}

export function lifecycleTransitionSummary(
  from: ProjectLifecycleState,
  to: ProjectLifecycleState,
): string {
  if (from === to) return `Project already ${lifecycleStateLabel(to).toLowerCase()}.`;
  return `Project ${lifecycleStateLabel(from).toLowerCase()} → ${lifecycleStateLabel(to).toLowerCase()}.`;
}

export function formatLifecycleCliBlock(input: {
  slug: string;
  hash: string;
  lifecycleState: ProjectLifecycleState;
  activeCount: number;
  activeLimit: number;
}): string[] {
  const lines = [
    `Project ${input.slug} (${input.hash})`,
    `Lifecycle: ${lifecycleStateLabel(input.lifecycleState)}`,
    lifecycleStateSummary(input.lifecycleState),
    `Active projects: ${String(input.activeCount)} / ${String(input.activeLimit)}`,
  ];
  return lines;
}
