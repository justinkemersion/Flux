import { formatProjectMetadataCliBlock } from "@flux/core/project-metadata";
import chalk from "chalk";
import { getApiClient } from "../api-client";
import { sectionBanner } from "../cli-layout";
import type { FluxJson } from "../flux-config";
import { resolveHash } from "../project-resolve";

export type CmdProjectMetadataOptions = {
  hash?: string;
  description?: string;
  brief?: string;
  clearDescription?: boolean;
  clearBrief?: boolean;
};

export async function cmdProjectMetadata(
  _name: string | undefined,
  opts: CmdProjectMetadataOptions,
  flux: FluxJson | null,
): Promise<void> {
  const hash = resolveHash(opts.hash, flux);
  const client = getApiClient();

  const hasPatch =
    opts.description !== undefined ||
    opts.brief !== undefined ||
    opts.clearDescription === true ||
    opts.clearBrief === true;

  if (hasPatch) {
    const patch: { description?: string | null; brief?: string | null } = {};
    if (opts.clearDescription) patch.description = null;
    else if (opts.description !== undefined) patch.description = opts.description;
    if (opts.clearBrief) patch.brief = null;
    else if (opts.brief !== undefined) patch.brief = opts.brief;
    const updated = await client.patchProjectMetadata(hash, patch);
    sectionBanner("Project metadata updated");
    for (const line of formatProjectMetadataCliBlock(
      updated.slug,
      updated.hash,
      updated,
    )) {
      console.log(chalk.white(line));
    }
    return;
  }

  const meta = await client.fetchProjectMetadataDetail(hash);
  sectionBanner("Project metadata");
  for (const line of formatProjectMetadataCliBlock(meta.slug, meta.hash, meta)) {
    console.log(chalk.white(line));
  }
}
