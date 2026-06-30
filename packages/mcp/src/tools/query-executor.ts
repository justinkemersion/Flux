/**
 * Execution backend for `flux.query.readonly`.
 *
 * The live executor reuses the same SSH tunnel as `flux db` commands
 * (`@flux/cli/db-access`) and connects with a short-lived, readonly,
 * project-scoped credential. It sets `statement_timeout` and
 * `default_transaction_read_only` as defense-in-depth on top of the
 * already-validated, LIMIT-wrapped SQL.
 *
 * The {@link ReadonlyQueryExecutor} interface is injectable so the tool can be
 * unit-tested without a live database or SSH host.
 */

import type {
  DatabaseAccessPlan,
  TemporaryDbCredential,
} from "@flux/cli/api-client";
import { openDatabaseTunnel } from "@flux/cli/db-access";

export interface ReadonlyQueryRequest {
  plan: DatabaseAccessPlan;
  credential: TemporaryDbCredential;
  /** Already validated + LIMIT-wrapped SQL. */
  wrappedSql: string;
  statementTimeoutMs: number;
}

export interface ReadonlyQueryResult {
  rows: unknown[];
  fields: string[];
}

export interface ReadonlyQueryExecutor {
  run(request: ReadonlyQueryRequest): Promise<ReadonlyQueryResult>;
}

interface PgFieldLike {
  name: string;
}
interface PgQueryResultLike {
  rows: unknown[];
  fields?: PgFieldLike[];
}
interface PgClientLike {
  connect(): Promise<void>;
  query(sql: string): Promise<PgQueryResultLike>;
  end(): Promise<void>;
}

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

async function liveRun(
  request: ReadonlyQueryRequest,
): Promise<ReadonlyQueryResult> {
  if (request.plan.mode !== "v2_shared") {
    throw new Error(
      "Read-only query execution is only supported for v2_shared projects.",
    );
  }

  const tunnel = await openDatabaseTunnel({
    plan: request.plan,
    localHost: "127.0.0.1",
  });

  const pgModule = (await import("pg")) as unknown as {
    Client: new (config: Record<string, unknown>) => PgClientLike;
    default?: { Client: new (config: Record<string, unknown>) => PgClientLike };
  };
  const PgClient = pgModule.Client ?? pgModule.default?.Client;
  if (!PgClient) {
    tunnel.child.kill();
    throw new Error("Failed to load the 'pg' client.");
  }

  const client = new PgClient({
    host: tunnel.localHost,
    port: tunnel.localPort,
    user: request.credential.username,
    password: request.credential.password,
    database: "postgres",
    ssl: false,
    application_name: "flux-mcp-readonly",
  });

  try {
    await client.connect();
    const searchPath =
      request.credential.searchPath.length > 0
        ? request.credential.searchPath
        : [request.credential.tenantSchema];
    await client.query(
      `SET search_path TO ${searchPath.map(quoteIdent).join(", ")}`,
    );
    await client.query(
      `SET statement_timeout = ${String(Math.trunc(request.statementTimeoutMs))}`,
    );
    await client.query("SET default_transaction_read_only = on");
    const result = await client.query(request.wrappedSql);
    return {
      rows: result.rows ?? [],
      fields: (result.fields ?? []).map((f) => f.name),
    };
  } finally {
    try {
      await client.end();
    } catch {
      /* ignore close errors */
    }
    try {
      tunnel.child.kill();
    } catch {
      /* ignore kill errors */
    }
  }
}

export const liveReadonlyQueryExecutor: ReadonlyQueryExecutor = {
  run: liveRun,
};
