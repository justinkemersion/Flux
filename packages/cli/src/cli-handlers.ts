/** CLI command handlers — split across `cli-handlers/` for architecture line limits. */
export { ensureRestoreVerifiedLatestBackup } from "./cli-handlers/backup-gate";
export {
  cmdBackupCreate,
  cmdBackupDownload,
  cmdBackupList,
  cmdBackupVerify,
} from "./cli-handlers/backup-commands";
export { cmdCors, cmdSupabaseRestPath } from "./cli-handlers/cors-supabase";
export { runVersionOutput, cmdUpdate } from "./cli-handlers/cli-version";
export { cmdDbReset } from "./cli-handlers/db-reset";
export { cmdEnvList, cmdEnvSet } from "./cli-handlers/env";
export { fatalString } from "./cli-handlers/fatal";
export {
  cmdDump,
  cmdKeys,
  cmdList,
  cmdNuke,
  cmdReap,
  cmdStart,
  cmdStop,
} from "./cli-handlers/lifecycle";
export { cmdLogs, cmdOpen } from "./cli-handlers/project-open-logs";
