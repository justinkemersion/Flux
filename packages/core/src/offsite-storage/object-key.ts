import type { BackupKind } from "../backup-trust.ts";

export type BuildOffsiteObjectKeyInput = {
  prefix: string;
  kind: BackupKind;
  /** v1 dedicated: projects.hash (7-char hex). */
  projectHash: string;
  /** v2 shared: catalog project UUID (tenant_id). */
  tenantId: string;
  backupId: string;
};

function normalizePrefix(prefix: string): string {
  return prefix.replace(/^\/+|\/+$/g, "").trim();
}

function assertSafeSegment(label: string, value: string): void {
  const v = value.trim();
  if (!v) {
    throw new Error(`Offsite object key segment "${label}" must not be empty.`);
  }
  if (v.includes("/") || v.includes("\\")) {
    throw new Error(`Offsite object key segment "${label}" must not contain path separators.`);
  }
}

/**
 * Canonical offsite object key:
 * `{prefix}/flux/v1/{projectHash}/{backupId}.dump`
 * `{prefix}/flux/v2/{tenantId}/{backupId}.dump`
 */
export function buildOffsiteObjectKey(input: BuildOffsiteObjectKeyInput): string {
  const prefix = normalizePrefix(input.prefix);
  assertSafeSegment("backupId", input.backupId);

  if (input.kind === "project_db") {
    assertSafeSegment("projectHash", input.projectHash);
    const segments = [prefix, "flux", "v1", input.projectHash.trim(), `${input.backupId.trim()}.dump`];
    return segments.filter(Boolean).join("/");
  }

  assertSafeSegment("tenantId", input.tenantId);
  const segments = [prefix, "flux", "v2", input.tenantId.trim(), `${input.backupId.trim()}.dump`];
  return segments.filter(Boolean).join("/");
}

export type OffsiteR2DisplayStatus = "uploaded" | "failed" | "missing" | "disabled";

/** Map pipeline offsite_status to operator-facing R2 label. */
export function formatOffsiteR2Status(input: {
  r2Enabled: boolean;
  offsiteStatus: string | null | undefined;
}): OffsiteR2DisplayStatus {
  if (!input.r2Enabled) {
    return "disabled";
  }
  const s = input.offsiteStatus?.trim().toLowerCase() ?? "";
  if (s === "complete") return "uploaded";
  if (s === "failed") return "failed";
  return "missing";
}
