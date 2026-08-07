import pg from "pg";

/** Wall-clock cap for the entire connect → COMMIT cycle. */
export const PUSH_TIMEOUT_MS = 30_000;

/**
 * Quotes a Postgres identifier safely. Tenant schemas derived from
 * `t_<shortid>_api` are already restricted to `[a-f0-9_]`, but defensive
 * quoting prevents future identifier sources from injecting via SET LOCAL.
 */
export function quoteIdent(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

/**
 * Minimal interface satisfied by `pg.Client` — used so tests can pass a
 * lightweight fake without dragging in a real connection.
 */
export interface PushPgClient {
  connect(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
  end(): Promise<unknown>;
}

export type PushPgClientFactory = () => PushPgClient;

export type ExecutePushInput = {
  schema: string;
  /** Per-tenant non-superuser role (`t_<shortId>_role`). */
  role: string;
  sql: string;
  /** Override for tests / non-`pg.Client` implementations. */
  clientFactory?: PushPgClientFactory;
  /** Override the wall-clock timeout (ms). Defaults to {@link PUSH_TIMEOUT_MS}. */
  timeoutMs?: number;
};

function defaultClientFactory(): PushPgClient {
  const sharedUrl = process.env.FLUX_SHARED_POSTGRES_URL?.trim();
  if (!sharedUrl) {
    throw new Error(
      "FLUX_SHARED_POSTGRES_URL is not set on the control plane.",
    );
  }
  return new pg.Client({ connectionString: sharedUrl });
}

/**
 * Executes a tenant SQL push against the shared cluster inside a single
 * transaction, scoped to the tenant role via `SET LOCAL ROLE` (not search_path alone).
 *
 * `statement_timeout` caps individual statements; the outer Promise.race
 * caps the total request including connect / commit hangs.
 *
 * On failure the transaction is rolled back; the original error is rethrown.
 */
export async function executePooledPush(input: ExecutePushInput): Promise<void> {
  const {
    beginPooledPushTransaction,
    finishPooledPushTransaction,
    rejectPooledPushPrivilegeEscape,
    resetPooledPushRole,
    setPooledPushTenantContext,
  } = await import("./pooled-push-session.ts");

  rejectPooledPushPrivilegeEscape(input.sql);

  const factory = input.clientFactory ?? defaultClientFactory;
  const timeoutMs = input.timeoutMs ?? PUSH_TIMEOUT_MS;
  const client = factory();
  let timer: NodeJS.Timeout | undefined;
  const work = (async () => {
    await client.connect();
    try {
      await beginPooledPushTransaction(client);
      await setPooledPushTenantContext(client, {
        schema: input.schema,
        role: input.role,
      });
      await client.query(input.sql);
      await resetPooledPushRole(client);
      await finishPooledPushTransaction(client);
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Rollback failure is non-fatal; surface the original error.
      }
      throw err;
    } finally {
      await client.end().catch(() => undefined);
    }
  })();

  try {
    await Promise.race([
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
