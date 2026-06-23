import {
  buildFluxMdGenerationPrompt,
  FLUX_MD_FILENAME,
  formatFluxMdCliBlock,
} from "@flux/core/flux-md";
import chalk from "chalk";
import { getApiClient } from "../api-client";
import { sectionBanner } from "../cli-layout";
import type { FluxJson } from "../flux-config";
import { findFluxProjectRoot, readLocalFluxMd } from "../local-flux-md";
import { resolveHash } from "../project-resolve";

export type CmdProjectBriefOptions = {
  hash?: string;
  push?: boolean;
  prompt?: boolean;
  clear?: boolean;
  generate?: boolean;
  save?: boolean;
};

export async function cmdProjectBrief(
  _name: string | undefined,
  opts: CmdProjectBriefOptions,
  flux: FluxJson | null,
): Promise<void> {
  const hash = resolveHash(opts.hash, flux);
  const client = getApiClient();
  const remote = await client.fetchProjectFluxMdDetail(hash);

  if (opts.generate) {
    sectionBanner("Generating FLUX.md draft");
    const summary = await client.generateProjectAiSummary(hash, "brief");
    console.log(summary.markdown.trimEnd());
    if (opts.save) {
      await client.syncProjectFluxMd(hash, summary.markdown);
      console.log("");
      console.log(chalk.green("Saved draft to dashboard snapshot."));
    } else {
      console.log("");
      console.log(
        chalk.dim(
          `Review the draft, save as FLUX.md locally, then \`flux project brief push --hash ${hash}\`. Or re-run \`flux project brief generate --save --hash ${hash}\`.`,
        ),
      );
    }
    return;
  }

  if (opts.prompt) {
    sectionBanner("Generate FLUX.md prompt");
    console.log(
      buildFluxMdGenerationPrompt({
        name: remote.name,
        slug: remote.slug,
        hash: remote.hash,
      }),
    );
    return;
  }

  const localRoot = await findFluxProjectRoot(process.cwd());
  const local = await readLocalFluxMd(process.cwd());

  if (opts.clear) {
    await client.syncProjectFluxMd(hash, null);
    sectionBanner("Project brief cleared");
    console.log(chalk.white(`Dashboard snapshot of ${FLUX_MD_FILENAME} removed.`));
    return;
  }

  if (opts.push) {
    if (!local) {
      const hint = localRoot
        ? `No ${FLUX_MD_FILENAME} in ${localRoot}. Add the file or run \`flux project brief prompt --hash ${hash}\`.`
        : "Run from a directory with flux.json, or create FLUX.md at the repo root.";
      throw new Error(hint);
    }
    const synced = await client.syncProjectFluxMd(hash, local.content);
    sectionBanner("Project brief synced");
    console.log(
      chalk.white(
        `Uploaded ${FLUX_MD_FILENAME} from ${local.root} (${String(local.content.length)} chars).`,
      ),
    );
    if (synced.syncedAt) {
      console.log(chalk.dim(`Dashboard snapshot: ${synced.syncedAt}`));
    }
    return;
  }

  sectionBanner("Project brief");
  for (const line of formatFluxMdCliBlock({
    slug: remote.slug,
    hash: remote.hash,
    name: remote.name,
    remote: { content: remote.content, syncedAt: remote.syncedAt },
    localFound: local !== null,
    localRoot,
  })) {
    console.log(chalk.white(line));
  }

  if (remote.content?.trim()) {
    console.log("");
    console.log(chalk.dim("--- dashboard snapshot ---"));
    console.log(remote.content.trimEnd());
  }

  if (!remote.content?.trim() && !local) {
    console.log("");
    console.log(
      chalk.yellow(
        `No ${FLUX_MD_FILENAME} synced or found locally. Run \`flux project brief prompt --hash ${hash}\` for a generation prompt.`,
      ),
    );
  } else if (!remote.content?.trim() && local) {
    console.log("");
    console.log(
      chalk.yellow(
        `Local ${FLUX_MD_FILENAME} found — run \`flux project brief push --hash ${hash}\` to show it in the dashboard.`,
      ),
    );
  }
}
