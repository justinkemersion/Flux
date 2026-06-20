import { getApiClient } from "../api-client";
import { isGauntletSlug } from "./names";
import type { GauntletProjectCtx, GauntletRunOptions } from "./types";

export interface SafeDeleteInput {
  project: GauntletProjectCtx;
  options: GauntletRunOptions;
  createdProjectSlugs: Set<string>;
}

export interface SafeDeleteResult {
  deleted: boolean;
  skipped: boolean;
  reason?: string;
}

/**
 * Gauntlet-only destructive cleanup.
 *
 * `skipBackupCheck: true` is intentional and isolated here: gauntlet creates
 * disposable projects marked with a strict slug prefix and tracked in-memory for
 * this process only. We never expose this as a reusable bypass for operator
 * workflows (`flux nuke` still requires restore-verified backup unless
 * `--skip-backup-check` is explicitly passed by a human).
 */
export async function safeDeleteGauntletProject(
  input: SafeDeleteInput,
): Promise<SafeDeleteResult> {
  const { project, options, createdProjectSlugs } = input;
  const slug = project.slug.trim().toLowerCase();

  if (!createdProjectSlugs.has(slug)) {
    return {
      deleted: false,
      skipped: true,
      reason: `Refusing delete: slug "${slug}" was not created by this gauntlet process`,
    };
  }

  if (!isGauntletSlug(slug, options.prefix)) {
    return {
      deleted: false,
      skipped: true,
      reason: `Refusing delete: slug "${slug}" does not match gauntlet marker pattern`,
    };
  }

  const client = getApiClient();
  await client.nukeProject(project.slug, project.hash, {
    skipBackupCheck: true,
  });

  createdProjectSlugs.delete(slug);
  return { deleted: true, skipped: false };
}

export function shouldAttemptCleanup(
  options: GauntletRunOptions,
  runFailed: boolean,
): boolean {
  if (options.keepFailed && runFailed) return false;
  return true;
}
