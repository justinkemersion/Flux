/** Structured stdout for the hourly platform minimum backup freshness scheduler. */

import { formatOpsAlertBody, queueOpsAlert } from "@/src/lib/ops-alert-email";

export function logBackupScheduler(message: string): void {
  console.log(`[flux] backup-scheduler: ${message}`);
}

export function logBackupSchedulerError(message: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`[flux] backup-scheduler: ${message} — ${detail}`);
  queueOpsAlert({
    fingerprint: `backup-scheduler:${message}`,
    subject: `[Flux] backup-scheduler: ${message}`,
    body: formatOpsAlertBody({
      source: "backup-scheduler",
      message,
      error: detail,
      ...parseSchedulerAlertContext(message),
    }),
  });
}

function parseSchedulerAlertContext(message: string): {
  projectSlug?: string;
  projectHash?: string;
  backupId?: string;
} {
  const backupId = /backupId=([^\s]+)/.exec(message)?.[1];
  const project = /(?:failed|pipeline)\s+([a-z0-9][a-z0-9-]*):([a-f0-9]+)\b/i.exec(
    message,
  );
  return {
    backupId,
    projectSlug: project?.[1],
    projectHash: project?.[2],
  };
}
