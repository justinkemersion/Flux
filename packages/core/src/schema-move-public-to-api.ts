import pg from "pg";

import { API_SCHEMA_PRIVILEGES_SQL } from "./api-schema-privileges.ts";

export type MovePublicToApiResult = {
  tablesMoved: number;
  sequencesMoved: number;
  viewsMoved: number;
};

function qIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * FK edges within `public`: parent table → child table (child references parent).
 * Move parents before children.
 */
async function listPublicFkParentChild(
  client: pg.Client,
): Promise<{ parent: string; child: string }[]> {
  const { rows } = await client.query<{
    parent: string;
    child: string;
  }>(
    `
    SELECT
      ref.relname AS parent,
      dep.relname AS child
    FROM pg_constraint c
    JOIN pg_class dep ON dep.oid = c.conrelid
    JOIN pg_class ref ON ref.oid = c.confrelid
    JOIN pg_namespace nd ON nd.oid = dep.relnamespace
    JOIN pg_namespace nr ON nr.oid = ref.relnamespace
    WHERE c.contype = 'f'
      AND nd.nspname = 'public'
      AND nr.nspname = 'public'
      AND dep.relkind IN ('r', 'p')
      AND ref.relkind IN ('r', 'p')
    `,
  );
  return rows;
}

async function listPublicBaseTables(client: pg.Client): Promise<string[]> {
  const { rows } = await client.query<{ relname: string }>(
    `
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
    `,
  );
  return rows.map((r) => r.relname);
}

/**
 * Topological order: parents before children (FK: child → parent).
 * Uses distinct parent sets per child so duplicate FK columns do not skew in-degrees.
 */
function orderTablesForMove(
  tables: string[],
  edges: { parent: string; child: string }[],
): string[] {
  const set = new Set(tables);
  const childToParents = new Map<string, Set<string>>();
  const childrenOfParent = new Map<string, Set<string>>();

  for (const t of tables) {
    childToParents.set(t, new Set());
    childrenOfParent.set(t, new Set());
  }

  for (const e of edges) {
    if (!set.has(e.parent) || !set.has(e.child)) continue;
    childToParents.get(e.child)?.add(e.parent);
    childrenOfParent.get(e.parent)?.add(e.child);
  }

  const inDegree = new Map<string, number>();
  for (const t of tables) {
    inDegree.set(t, childToParents.get(t)?.size ?? 0);
  }

  const queue: string[] = [];
  for (const [t, d] of inDegree) {
    if (d === 0) queue.push(t);
  }
  queue.sort();

  const out: string[] = [];
  while (queue.length > 0) {
    const p = queue.shift()!;
    out.push(p);
    for (const ch of childrenOfParent.get(p) ?? []) {
      const parents = childToParents.get(ch);
      parents?.delete(p);
      const nd = parents?.size ?? 0;
      inDegree.set(ch, nd);
      if (nd === 0) {
        queue.push(ch);
        queue.sort();
      }
    }
  }

  if (out.length !== tables.length) {
    const remaining = tables.filter((t) => !out.includes(t)).sort();
    return [...out, ...remaining];
  }
  return out;
}

async function listPublicSequences(client: pg.Client): Promise<string[]> {
  const { rows } = await client.query<{ relname: string }>(
    `
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
    ORDER BY c.relname
    `,
  );
  return rows.map((r) => r.relname);
}

async function listPublicViews(client: pg.Client): Promise<string[]> {
  const { rows } = await client.query<{ relname: string }>(
    `
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'v'
    ORDER BY c.relname
    `,
  );
  return rows.map((r) => r.relname);
}

async function listPublicMatviews(client: pg.Client): Promise<string[]> {
  const { rows } = await client.query<{ relname: string }>(
    `
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'm'
    ORDER BY c.relname
    `,
  );
  return rows.map((r) => r.relname);
}

/**
 * Moves user tables, sequences, views, and materialized views from `public` to `api`, then
 * reapplies {@link API_SCHEMA_PRIVILEGES_SQL}.
 */
export async function movePublicSchemaObjectsToApi(
  client: pg.Client,
): Promise<MovePublicToApiResult> {
  let tablesMoved = 0;
  let sequencesMoved = 0;
  let viewsMoved = 0;

  const baseTables = await listPublicBaseTables(client);
  const fkEdges = await listPublicFkParentChild(client);
  const ordered = orderTablesForMove(baseTables, fkEdges);

  for (const relname of ordered) {
    await client.query(
      `ALTER TABLE public.${qIdent(relname)} SET SCHEMA api`,
    );
    tablesMoved++;
  }

  const sequences = await listPublicSequences(client);
  for (const relname of sequences) {
    await client.query(
      `ALTER SEQUENCE public.${qIdent(relname)} SET SCHEMA api`,
    );
    sequencesMoved++;
  }

  let progress = true;
  const viewNames = await listPublicViews(client);
  const remainingViews = new Set(viewNames);
  while (progress && remainingViews.size > 0) {
    progress = false;
    for (const v of [...remainingViews].sort()) {
      try {
        await client.query(
          `ALTER VIEW public.${qIdent(v)} SET SCHEMA api`,
        );
        remainingViews.delete(v);
        viewsMoved++;
        progress = true;
      } catch {
        /* dependency order — retry next pass */
      }
    }
  }
  if (remainingViews.size > 0) {
    const names = [...remainingViews].join(", ");
    throw new Error(
      `Could not move all views from public to api (remaining: ${names}). ` +
        `Resolve dependencies or move manually.`,
    );
  }

  let matProgress = true;
  const matNames = await listPublicMatviews(client);
  const remainingMat = new Set(matNames);
  while (matProgress && remainingMat.size > 0) {
    matProgress = false;
    for (const relname of [...remainingMat].sort()) {
      try {
        await client.query(
          `ALTER MATERIALIZED VIEW public.${qIdent(relname)} SET SCHEMA api`,
        );
        remainingMat.delete(relname);
        viewsMoved++;
        matProgress = true;
      } catch {
        /* dependency order */
      }
    }
  }
  if (remainingMat.size > 0) {
    throw new Error(
      `Could not move all materialized views from public to api (remaining: ${[...remainingMat].join(", ")}).`,
    );
  }

  await client.query(API_SCHEMA_PRIVILEGES_SQL);

  return { tablesMoved, sequencesMoved, viewsMoved };
}

export async function runMovePublicToApiWithClient(
  hostPort: number,
  password: string,
  pgUser: string,
): Promise<MovePublicToApiResult> {
  const client = new pg.Client({
    host: "localhost",
    port: hostPort,
    user: pgUser,
    password,
    database: "postgres",
    connectionTimeoutMillis: 8000,
  });
  await client.connect();
  try {
    await client.query("BEGIN");
    const result = await movePublicSchemaObjectsToApi(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    await client.end();
  }
}
