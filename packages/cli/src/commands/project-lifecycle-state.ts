import chalk from "chalk";
import {
  formatLifecycleCliBlock,
  lifecycleActionLabel,
  lifecycleStateLabel,
} from "@flux/core/project-lifecycle-state";
import { getApiClient } from "../api-client";
import type { FluxJson } from "../flux-config";
import { resolveHash } from "../project-resolve";

type LifecycleOpts = {
  hash?: string;
  show?: boolean;
};

export async function cmdProjectLifecycle(
  action: import("@flux/core/project-lifecycle-state").ProjectLifecycleAction | undefined,
  opts: LifecycleOpts,
  flux: FluxJson | null,
): Promise<void> {
  const hash = resolveHash(opts.hash, flux);
  const client = getApiClient();

  if (opts.show || !action) {
    const info = await client.getProjectLifecycleState(hash);
    for (const line of formatLifecycleCliBlock({
      slug: info.slug,
      hash: info.hash,
      lifecycleState: info.lifecycleState,
      activeCount: info.activeCount,
      activeLimit: info.activeLimit,
    })) {
      console.log(line);
    }
    return;
  }

  console.log(
    chalk.blue(`${lifecycleActionLabel(action)} (${hash})…`),
  );
  const result = await client.runProjectLifecycleAction(hash, action);
  if (result.noop) {
    console.log(
      chalk.dim(`Already ${lifecycleStateLabel(result.lifecycleState).toLowerCase()}.`),
    );
    return;
  }
  console.log(
    chalk.green("✓"),
    chalk.white(lifecycleStateLabel(result.lifecycleState)),
  );
}
