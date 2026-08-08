import { adaptPooledPushSql } from "@flux/core/pooled-push-sql-adapt";
import {
  buildFluxMigrationsLedgerEnsureSql,
  buildMigrationLedgerInsertSql,
  listFluxMigrationsSql,
  migrationConflictMessage,
  normalizePushSql,
  type FluxMigrationRecord,
  type MigrationPushMeta,
  resolveMigrationLedgerAction,
  selectMigrationChecksumSql,
} from "@flux/core/sql-migrations";
import {
  buildRepeatableLedgerEnsureSql,
  buildRepeatableLedgerUpsertSql,
  resolveRepeatableLedgerAction,
  selectRepeatableChecksumSql,
  type RepeatablePushMeta,
} from "@flux/core/sql-repeatable-scripts";
import type { PushPgClient, PushPgClientFactory } from "@/src/lib/pooled-push";
import { PUSH_TIMEOUT_MS } from "@/src/lib/pooled-push";
import {
  beginPooledPushTransaction,
  finishPooledPushTransaction,
  enforcePooledPushRlsInvariants,
  rejectPooledPushPrivilegeEscape,
  resetPooledPushRole,
  setPooledPushTenantContext,
} from "@/src/lib/pooled-push-session";
import pg from "pg";

function adaptUserSqlForPooledPush(
  schema: string,
  role: string,
  userSql: string,
): string {
  return adaptPooledPushSql(normalizePushSql(userSql), {
    tenantSchema: schema,
    tenantRole: role,
  });
}

function defaultClientFactory(): PushPgClient {
  const sharedUrl = process.env.FLUX_SHARED_POSTGRES_URL?.trim();
  if (!sharedUrl) {
    throw new Error(
      "FLUX_SHARED_POSTGRES_URL is not set on the control plane.",
    );
  }
  return new pg.Client({ connectionString: sharedUrl });
}

function isUndefinedTableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  return code === "42P01" || code === "3F000";
}

function rowToRecord(row: Record<string, unknown>): FluxMigrationRecord {
  return {
    version: String(row.version ?? ""),
    filename: String(row.filename ?? ""),
    checksum: String(row.checksum ?? ""),
    ...(row.appliedAt != null
      ? { appliedAt: String(row.appliedAt) }
      : row.applied_at != null
        ? { appliedAt: String(row.applied_at) }
        : {}),
  };
}

async function runWithPushTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `SQL push exceeded ${String(timeoutMs / 1000)}s timeout`,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function listPooledAppliedMigrations(input: {
  tenantSchema: string;
  clientFactory?: PushPgClientFactory;
}): Promise<FluxMigrationRecord[]> {
  const factory = input.clientFactory ?? defaultClientFactory;
  const client = factory();
  try {
    await client.connect();
    await client.query(buildFluxMigrationsLedgerEnsureSql(input.tenantSchema));
    const res = await client.query(listFluxMigrationsSql(input.tenantSchema));
    const rows = (res as { rows?: Record<string, unknown>[] }).rows ?? [];
    return rows.map(rowToRecord);
  } catch (err) {
    if (isUndefinedTableError(err)) return [];
    throw err;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export type ExecuteMigrationPushInput = {
  schema: string;
  role: string;
  ddlRole: string;
  userSql: string;
  migration: MigrationPushMeta;
  clientFactory?: PushPgClientFactory;
  timeoutMs?: number;
};

export type ExecuteMigrationPushResult = { skipped: boolean };

/**
 * Migration-mode pooled push: trusted ledger ops as control-plane role; user SQL under tenant role.
 */
export async function executePooledMigrationPush(
  input: ExecuteMigrationPushInput,
): Promise<ExecuteMigrationPushResult> {
  rejectPooledPushPrivilegeEscape(input.userSql);

  const factory = input.clientFactory ?? defaultClientFactory;
  const timeoutMs = input.timeoutMs ?? PUSH_TIMEOUT_MS;
  const client = factory();

  const work = (async () => {
    await client.connect();
    try {
      await beginPooledPushTransaction(client);
      await client.query(buildFluxMigrationsLedgerEnsureSql(input.schema));

      const lookup = await client.query(
        selectMigrationChecksumSql(input.migration.version, input.schema),
      );
      const rows = (lookup as { rows?: { checksum: string }[] }).rows ?? [];
      const existing = rows[0]?.checksum
        ? { checksum: rows[0].checksum }
        : undefined;
      const action = resolveMigrationLedgerAction(existing, input.migration);

      if (action === "conflict") {
        throw new Error(
          migrationConflictMessage(
            input.migration,
            existing!.checksum,
          ),
        );
      }
      if (action === "skip") {
        await client.query("COMMIT");
        return { skipped: true as const };
      }

      await setPooledPushTenantContext(client, {
        schema: input.schema,
        ddlRole: input.ddlRole,
      });
      await client.query(
        adaptUserSqlForPooledPush(input.schema, input.role, input.userSql),
      );
      await resetPooledPushRole(client);
      await enforcePooledPushRlsInvariants(client, {
        schema: input.schema,
        runtimeRole: input.role,
      });
      await client.query(
        buildMigrationLedgerInsertSql({
          tenantSchema: input.schema,
          migration: input.migration,
        }),
      );
      await finishPooledPushTransaction(client);
      return { skipped: false as const };
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    } finally {
      await client.end().catch(() => undefined);
    }
  })();

  return runWithPushTimeout(work, timeoutMs);
}

export type ExecuteRepeatablePushInput = {
  schema: string;
  role: string;
  ddlRole: string;
  userSql: string;
  repeatable: RepeatablePushMeta;
  clientFactory?: PushPgClientFactory;
  timeoutMs?: number;
};

export type ExecuteRepeatablePushResult = {
  skipped: boolean;
  previousChecksum?: string;
};

/**
 * Repeatable-mode pooled push: trusted ledger ops as control-plane role; user SQL under tenant role.
 */
export async function executePooledRepeatablePush(
  input: ExecuteRepeatablePushInput,
): Promise<ExecuteRepeatablePushResult> {
  rejectPooledPushPrivilegeEscape(input.userSql);

  const factory = input.clientFactory ?? defaultClientFactory;
  const timeoutMs = input.timeoutMs ?? PUSH_TIMEOUT_MS;
  const client = factory();

  const work = (async () => {
    await client.connect();
    try {
      await beginPooledPushTransaction(client);
      await client.query(buildRepeatableLedgerEnsureSql(input.schema));

      const lookup = await client.query(
        selectRepeatableChecksumSql(input.repeatable.scriptId, input.schema),
      );
      const rows = (lookup as { rows?: { checksum: string }[] }).rows ?? [];
      const existing = rows[0]?.checksum
        ? { checksum: rows[0].checksum }
        : undefined;
      const action = resolveRepeatableLedgerAction(
        existing,
        input.repeatable,
        input.repeatable.force === true,
      );

      if (action === "skip") {
        await client.query("COMMIT");
        return { skipped: true as const };
      }

      const previousChecksum = existing?.checksum;
      await setPooledPushTenantContext(client, {
        schema: input.schema,
        ddlRole: input.ddlRole,
      });
      await client.query(
        adaptUserSqlForPooledPush(input.schema, input.role, input.userSql),
      );
      await resetPooledPushRole(client);
      await enforcePooledPushRlsInvariants(client, {
        schema: input.schema,
        runtimeRole: input.role,
      });
      await client.query(
        buildRepeatableLedgerUpsertSql({
          tenantSchema: input.schema,
          meta: input.repeatable,
        }),
      );
      await finishPooledPushTransaction(client);
      return {
        skipped: false as const,
        ...(previousChecksum && previousChecksum !== input.repeatable.checksum
          ? { previousChecksum }
          : {}),
      };
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    } finally {
      await client.end().catch(() => undefined);
    }
  })();

  return runWithPushTimeout(work, timeoutMs);
}
