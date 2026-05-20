import {
  buildMigrationPushSql,
  FLUX_MIGRATIONS_DDL,
  LIST_FLUX_MIGRATIONS_SQL,
  migrationConflictMessage,
  type FluxMigrationRecord,
  type MigrationPushMeta,
  resolveMigrationLedgerAction,
  selectMigrationChecksumSql,
} from "@flux/core/sql-migrations";
import type { PushPgClient, PushPgClientFactory } from "@/src/lib/pooled-push";
import { quoteIdent, PUSH_TIMEOUT_MS } from "@/src/lib/pooled-push";
import pg from "pg";

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

export async function listPooledAppliedMigrations(input?: {
  clientFactory?: PushPgClientFactory;
}): Promise<FluxMigrationRecord[]> {
  const factory = input?.clientFactory ?? defaultClientFactory;
  const client = factory();
  try {
    await client.connect();
    const res = await client.query(LIST_FLUX_MIGRATIONS_SQL);
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
  userSql: string;
  migration: MigrationPushMeta;
  clientFactory?: PushPgClientFactory;
  timeoutMs?: number;
};

export type ExecuteMigrationPushResult = { skipped: boolean };

/**
 * Migration-mode pooled push: ledger in `flux` schema, user SQL under tenant search_path.
 */
export async function executePooledMigrationPush(
  input: ExecuteMigrationPushInput,
): Promise<ExecuteMigrationPushResult> {
  const factory = input.clientFactory ?? defaultClientFactory;
  const timeoutMs = input.timeoutMs ?? PUSH_TIMEOUT_MS;
  const client = factory();
  let timer: NodeJS.Timeout | undefined;

  const work = (async () => {
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '30s'");
      await client.query(
        `SET LOCAL search_path TO ${quoteIdent(input.schema)}, public`,
      );
      await client.query(FLUX_MIGRATIONS_DDL);

      const lookup = await client.query(
        selectMigrationChecksumSql(input.migration.version),
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

      const wrapped = buildMigrationPushSql({
        userSql: input.userSql,
        migration: input.migration,
      });
      await client.query(wrapped);
      await client.query("NOTIFY pgrst, 'reload schema';");
      await client.query("COMMIT");
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
