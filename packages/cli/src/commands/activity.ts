import {
  activityDayLabel,
  activityKindIcon,
  type ProjectActivityEvent,
} from "@flux/core/project-activity";
import chalk from "chalk";
import { getApiClient } from "../api-client";
import { sectionBanner } from "../cli-layout";
import type { FluxJson } from "../flux-config";
import { resolveHash } from "../project-resolve";
import { formatCliTimestampDisplay } from "../utils/cli-timestamp";

export type CmdActivityOptions = {
  hash?: string;
  limit?: number;
};

function printActivityTimeline(
  slug: string,
  hash: string,
  events: ProjectActivityEvent[],
): void {
  sectionBanner("Activity");
  console.log(
    chalk.dim(`Project ${slug} (${hash}) · ${String(events.length)} event(s)`),
  );
  console.log("");

  if (events.length === 0) {
    console.log(chalk.dim("  No activity recorded yet."));
    return;
  }

  let lastDay = "";
  for (const event of events) {
    const day = activityDayLabel(event.createdAt);
    if (day !== lastDay) {
      if (lastDay) console.log("");
      console.log(chalk.white(day));
      lastDay = day;
    }
    const ts = formatCliTimestampDisplay(event.createdAt);
    console.log(
      `  ${activityKindIcon(event.kind)} ${chalk.white(event.summary)}`,
    );
    console.log(chalk.dim(`     ${ts}`));
  }
}

export async function cmdActivity(
  _name: string | undefined,
  opts: CmdActivityOptions,
  flux: FluxJson | null,
): Promise<void> {
  const hash = resolveHash(opts.hash, flux);
  const client = getApiClient();
  const limit = opts.limit ?? 50;
  const result = await client.fetchProjectActivity(hash, limit);
  printActivityTimeline(result.projectSlug, result.hash, result.events);
}
