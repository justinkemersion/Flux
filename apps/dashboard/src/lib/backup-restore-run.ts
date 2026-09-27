/**
 * Host-side restore used by backup verification tests and the same SQL / flags
 * the disposable-container verifier applies.
 *
 * `verifyBackupRestore` runs `pg_restore` inside a throwaway container (the dump
 * path is not a Docker-host path). It uses {@link BACKUP_VERIFY_PG_RESTORE_ARGS},
 * {@link buildBackupVerifyPreRestoreSql}, and {@link pgRestoreRejectedReason}
 * from this module so the two transports cannot drift.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  BACKUP_VERIFY_PG_RESTORE_ARGS,
  LIVE_PG_RESTORE_ARGS,
  buildRestoreRoleStubSql,
  collectRestoreRoleNames,
  pgRestoreRejectedReason,
} from "@flux/core/backup-restore-roles";

export { BACKUP_VERIFY_PG_RESTORE_ARGS, LIVE_PG_RESTORE_ARGS };
import {
  buildBackupVerifyPreRestoreSql,
  type BackupVerifyPreRestoreKind,
} from "@/src/lib/backup-verify-pre-restore-sql";

const execFileAsync = promisify(execFile);

export type PgRestoreConnection = {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
};

function bufferText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return "";
}

function execFailure(err: unknown): { code: number | null; stderr: string; enoent: boolean } {
  const e = err as NodeJS.ErrnoException & { stderr?: unknown; stdout?: unknown };
  return {
    code: typeof e.code === "number" ? e.code : null,
    stderr: `${bufferText(e.stderr)}\n${bufferText(e.stdout)}`.trim(),
    enoent: e.code === "ENOENT",
  };
}

function pgEnv(conn: PgRestoreConnection): NodeJS.ProcessEnv {
  return { ...process.env, PGPASSWORD: conn.password };
}

function psqlBaseArgs(conn: PgRestoreConnection): string[] {
  return ["-h", conn.host, "-p", conn.port, "-U", conn.user, "-d", conn.database];
}

/** `pg_restore --schema-only` text. Fails closed on a corrupt archive. */
export async function readCustomDumpSchemaSql(dumpPath: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "pg_restore",
      ["--schema-only", "-f", "-", dumpPath],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    const reason = pgRestoreRejectedReason(0, bufferText(stderr));
    if (reason) throw new Error(reason);
    return stdout.toString();
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith("pg_restore failed")) throw err;
    const failure = execFailure(err);
    if (failure.enoent) {
      throw new Error(
        "pg_restore not found (ENOENT). Install postgresql-client to read backup archives.",
      );
    }
    throw new Error(
      pgRestoreRejectedReason(failure.code ?? 1, failure.stderr) ??
        "Failed to read dump schema.",
    );
  }
}

async function applySql(conn: PgRestoreConnection, sql: string): Promise<void> {
  try {
    await execFileAsync("psql", [...psqlBaseArgs(conn), "-v", "ON_ERROR_STOP=1", "-c", sql], {
      env: pgEnv(conn),
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err: unknown) {
    const failure = execFailure(err);
    if (failure.enoent) {
      throw new Error("psql not found (ENOENT). Install postgresql-client to restore backups.");
    }
    throw new Error(
      failure.stderr.length > 0
        ? `Restore role setup failed: ${failure.stderr.slice(0, 1500)}`
        : "Restore role setup failed.",
    );
  }
}

async function runPgRestore(
  conn: PgRestoreConnection,
  dumpPath: string,
  args: readonly string[],
): Promise<{ stderr: string }> {
  let code = 0;
  let stderr = "";
  try {
    const result = await execFileAsync(
      "pg_restore",
      [...psqlBaseArgs(conn), ...args, dumpPath],
      { env: pgEnv(conn), maxBuffer: 64 * 1024 * 1024 },
    );
    stderr = bufferText(result.stderr);
  } catch (err: unknown) {
    const failure = execFailure(err);
    if (failure.enoent) {
      throw new Error("pg_restore not found (ENOENT). Install postgresql-client to restore backups.");
    }
    code = failure.code ?? 1;
    stderr = failure.stderr;
  }
  const reason = pgRestoreRejectedReason(code, stderr);
  if (reason) throw new Error(reason);
  return { stderr };
}

/**
 * Disposable-verify sequence against an already-running Postgres: stub roles
 * from the archive and catalog id, then `pg_restore` with the verify flags.
 * Non-zero exit or ignored errors throw.
 */
export async function restoreDumpForVerification(input: {
  dumpPath: string;
  projectId: string;
  kind: BackupVerifyPreRestoreKind;
  connection: PgRestoreConnection;
}): Promise<{ stderr: string }> {
  const schemaSql = await readCustomDumpSchemaSql(input.dumpPath);
  const preSql = buildBackupVerifyPreRestoreSql({
    projectId: input.projectId,
    kind: input.kind,
    schemaSql,
  });
  await applySql(input.connection, preSql);
  return runPgRestore(input.connection, input.dumpPath, BACKUP_VERIFY_PG_RESTORE_ARGS);
}

/**
 * Live restore sequence (`flux db restore`): stub missing roles, then
 * `pg_restore --clean --if-exists` without `--no-owner` / `--no-acl`.
 * Policies, ownership, grants, and default privileges in the archive are applied.
 * Stub roles are left in place because restored objects reference them.
 */
export async function restoreDumpPreservingOwnership(input: {
  dumpPath: string;
  projectId?: string;
  connection: PgRestoreConnection;
}): Promise<{ stderr: string }> {
  const schemaSql = await readCustomDumpSchemaSql(input.dumpPath);
  const preSql = buildRestoreRoleStubSql(
    collectRestoreRoleNames(schemaSql, input.projectId),
  );
  if (preSql.trim().length > 0) {
    await applySql(input.connection, preSql);
  }
  return runPgRestore(input.connection, input.dumpPath, LIVE_PG_RESTORE_ARGS);
}
