import type { ReactElement } from "react";
import type { ProjectRow } from "@/src/components/projects/project-types";
import {
  engineModeAriaLabel,
  engineModeShortLabel,
  engineModeTooltip,
} from "@/src/lib/engine-mode-display";

type Surface = "darkCard" | "lightHeader";

type Props = {
  mode: ProjectRow["mode"];
  /** Fleet cards use dark styling; mesh readout / project console header uses light shell. */
  surface?: Surface;
};

const surfaceClass: Record<Surface, string> = {
  darkCard:
    "inline-flex shrink-0 items-center rounded-full border border-violet-500/35 bg-violet-950/35 px-2.5 py-1 text-xs font-medium text-violet-100",
  lightHeader:
    "inline-flex shrink-0 items-center rounded-full border border-zinc-300 bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200",
};

/**
 * Compact deployment model badge (Pooled vs Dedicated), not a product version.
 */
export function EngineModeBadge({
  mode,
  surface = "lightHeader",
}: Props): ReactElement {
  return (
    <span
      className={surfaceClass[surface]}
      title={engineModeTooltip(mode)}
      aria-label={engineModeAriaLabel(mode)}
    >
      {engineModeShortLabel(mode)}
    </span>
  );
}
