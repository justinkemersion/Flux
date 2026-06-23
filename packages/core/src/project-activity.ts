/**
 * Project activity timeline — shared event kinds and display helpers.
 * Control plane stores rows in `project_activity_events`; no secrets in metadata.
 */

export const PROJECT_ACTIVITY_KINDS = [
  "project.created",
  "migration.applied",
  "backup.created",
  "backup.verified",
  "db.temp_credential_issued",
  "db.tunnel_opened",
] as const;

export type ProjectActivityKind = (typeof PROJECT_ACTIVITY_KINDS)[number];

export type ProjectActivityEvent = {
  id: string;
  projectId: string;
  userId: string | null;
  kind: ProjectActivityKind;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

const SECRET_KEY_PATTERN =
  /password|secret|token|jwt|credential|authorization|api[_-]?key/i;

/** Drop metadata keys that may carry secrets; values are not logged raw. */
export function sanitizeActivityMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!metadata) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    if (typeof value === "string" && value.length > 500) {
      out[key] = `${value.slice(0, 497)}…`;
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function migrationAppliedSummary(filename: string): string {
  return `Migration ${filename} applied`;
}

export function backupCreatedSummary(kind: string): string {
  return kind === "manual" ? "Backup created" : `Backup created (${kind})`;
}

export function backupVerifiedSummary(): string {
  return "Backup verified";
}

export function projectCreatedSummary(slug: string): string {
  return `Project ${slug} created`;
}

export function tempCredentialSummary(access: string, ttlSeconds: number): string {
  return `Temporary DB credential issued (${access}, ${String(ttlSeconds)}s TTL)`;
}

export function tunnelOpenedSummary(): string {
  return "DB tunnel opened";
}

/** Day bucket label for grouping timeline rows (UTC calendar day). */
export function activityDayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown date";
  const startOfDay = (x: Date): number =>
    Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  const diffDays = Math.round(
    (startOfDay(now) - startOfDay(d)) / (24 * 60 * 60 * 1000),
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function activityKindIcon(kind: ProjectActivityKind): string {
  switch (kind) {
    case "project.created":
      return "✓";
    case "migration.applied":
      return "✓";
    case "backup.created":
    case "backup.verified":
      return "✓";
    case "db.temp_credential_issued":
    case "db.tunnel_opened":
      return "✓";
    default:
      return "·";
  }
}
