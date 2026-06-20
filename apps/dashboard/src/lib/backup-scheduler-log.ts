/** Structured stdout for the hourly platform minimum backup freshness scheduler. */

export function logBackupScheduler(message: string): void {
  console.log(`[flux] backup-scheduler: ${message}`);
}

export function logBackupSchedulerError(message: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`[flux] backup-scheduler: ${message} — ${detail}`);
}
