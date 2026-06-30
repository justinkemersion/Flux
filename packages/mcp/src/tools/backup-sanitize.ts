/**
 * Sanitize backup-related API payloads for MCP output and audit metadata.
 * Never expose artifact paths, volume roots, offsite storage details, or raw rows.
 */

import type { ListProjectBackupsResult } from "@flux/cli/api-client";

const STORAGE_KEY_RE =
  /(path|artifact|volume|offsite|bucket|signed|url|etag|checksum|local)/i;

/** Keys dropped from any MCP-facing backup metadata. */
export function sanitizeBackupMetadata(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (STORAGE_KEY_RE.test(key)) continue;
    out[key] = val;
  }
  return out;
}

export function platformBackupCompliantFromList(
  result: Pick<ListProjectBackupsResult, "platformMinimumBackupFreshness">,
): boolean | undefined {
  return result.platformMinimumBackupFreshness?.freshness.platformBackupCompliant;
}
