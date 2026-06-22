import { getApiClient } from "../api-client.js";
import type { FluxJson } from "../flux-config.js";
import { resolveHash } from "../project-resolve.js";
import {
  printDbCounts,
  printDbDescribe,
  printDbInspect,
  printDbTables,
} from "../lib/db-inspect-output.js";

export interface DbInspectOptions {
  project?: string;
  hash?: string;
  exact?: boolean;
}

/**
 * flux db inspect [name]
 * Project-level schema overview: mode, schema, table count, total rows,
 * largest tables, warnings.
 */
export async function cmdDbInspect(
  _name: string | undefined,
  opts: DbInspectOptions,
  flux: FluxJson | null,
): Promise<void> {
  const hash = resolveHash(opts.hash, flux);
  const client = getApiClient();
  const result = await client.schemaInspectProject({ hash });
  printDbInspect(result);
}

/**
 * flux db tables [name]
 * Table list with column count, estimated row count, RLS state.
 */
export async function cmdDbTables(
  _name: string | undefined,
  opts: DbInspectOptions,
  flux: FluxJson | null,
): Promise<void> {
  const hash = resolveHash(opts.hash, flux);
  const client = getApiClient();
  const result = await client.schemaInspectProject({ hash });
  printDbTables(result);
}

/**
 * flux db describe <table> [name]
 * Column details, primary key, foreign keys, RLS state for a single table.
 * The table name is matched client-side against the inspection result
 * (no arbitrary SQL is accepted or executed for this filter).
 */
export async function cmdDbDescribe(
  table: string,
  _name: string | undefined,
  opts: DbInspectOptions,
  flux: FluxJson | null,
): Promise<void> {
  if (!table?.trim()) {
    throw new Error("Missing table name. Usage: flux db describe <table> [project]");
  }
  const hash = resolveHash(opts.hash, flux);
  const client = getApiClient();
  const result = await client.schemaInspectProject({ hash });
  printDbDescribe(result, table.trim());
}

/**
 * flux db counts [name]
 * Row counts for all tables. Default: approximate (fast). --exact: exact count(*).
 * Exact counts are run server-side only when the schema has ≤5 tables
 * (controlled by the inspection API; larger schemas fall back to estimates).
 */
export async function cmdDbCounts(
  _name: string | undefined,
  opts: DbInspectOptions,
  flux: FluxJson | null,
): Promise<void> {
  const hash = resolveHash(opts.hash, flux);
  const exact = opts.exact === true;
  const client = getApiClient();
  const result = await client.schemaInspectProject({
    hash,
    includeExactCounts: exact,
  });
  printDbCounts(result, exact);
}
