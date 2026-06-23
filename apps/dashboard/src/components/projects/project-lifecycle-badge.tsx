import { lifecycleStateLabel } from "@flux/core/project-lifecycle-state";
import type { ProjectLifecycleState } from "@flux/core/project-lifecycle-state";

type Props = {
  state: ProjectLifecycleState | undefined;
  className?: string;
};

const STYLES: Record<ProjectLifecycleState, string> = {
  active:
    "border-emerald-200/80 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200",
  dormant:
    "border-amber-200/80 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200",
  archived:
    "border-zinc-300/80 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-400",
};

export function ProjectLifecycleBadge({ state, className = "" }: Props) {
  const normalized: ProjectLifecycleState =
    state === "dormant" || state === "archived" ? state : "active";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STYLES[normalized]} ${className}`}
    >
      {lifecycleStateLabel(normalized)}
    </span>
  );
}
