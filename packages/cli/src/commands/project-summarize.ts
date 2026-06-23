import chalk from "chalk";
import { getApiClient } from "../api-client";
import { sectionBanner } from "../cli-layout";
import type { FluxJson } from "../flux-config";
import { resolveHash } from "../project-resolve";

export type CmdProjectSummarizeOptions = {
  hash?: string;
  kind?: string;
};

export async function cmdProjectSummarize(
  _name: string | undefined,
  opts: CmdProjectSummarizeOptions,
  flux: FluxJson | null,
): Promise<void> {
  const hash = resolveHash(opts.hash, flux);
  const kindRaw = opts.kind?.trim().toLowerCase() ?? "activity";
  if (kindRaw !== "activity" && kindRaw !== "resume") {
    throw new Error('kind must be "activity" or "resume"');
  }
  const client = getApiClient();
  sectionBanner(kindRaw === "resume" ? "Resume brief" : "Activity summary");
  const summary = await client.generateProjectAiSummary(hash, kindRaw);
  console.log(chalk.white(summary.markdown.trimEnd()));
}
