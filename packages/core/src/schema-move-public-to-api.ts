import type Docker from "dockerode";

import { buildApiSchemaPrivilegesSql } from "./api-schema-privileges.ts";
import { assertFluxApiSchemaIdentifier } from "./api-schema-strategy.ts";
import {
  createFluxPgRunner,
  type FluxPgRunner,
} from "./postgres-internal-exec.ts";

export type MovePublicToApiResult = {
  tablesMoved: number;
  sequencesMoved: number;
  viewsMoved: number;
};

function qIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function sqlStringLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * True if `api` already has any relation (table, sequence, view, …) with this name.
 * Supabase-style dumps sometimes create objects in both `public` and `api`; moving `public` → `api`
 * then fails with "already exists". In that case we drop the redundant `public` copy.
 */
async function targetSchemaHasRelationNamed(
  run: FluxPgRunner,
  targetSchema: string,
  relname: string,
): Promise<boolean> {
  const { rows } = await run.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${sqlStringLiteral(targetSchema)}::name AND c.relname = ${sqlStringLiteral(relname)}::name
    ) AS exists
    `,
  );
  const row = rows[0] as { exists?: boolean } | undefined;
  return row?.exists === true;
}

/**
 * FK edges within `public`: parent table → child table (child references parent).
 * Move parents before children.
 */
async function listPublicFkParentChild(
  run: FluxPgRunner,
): Promise<{ parent: string; child: string }[]> {
  const { rows } = await run.query(
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
  return rows as { parent: string; child: string }[];
}

async function listPublicBaseTables(run: FluxPgRunner): Promise<string[]> {
  const { rows } = await run.query(
    `
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
    `,
  );
  return (rows as { relname: string }[]).map((r) => r.relname);
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

async function listPublicSequences(run: FluxPgRunner): Promise<string[]> {
  const { rows } = await run.query(
    `
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
    ORDER BY c.relname
    `,
  );
  return (rows as { relname: string }[]).map((r) => r.relname);
}

async function listPublicViews(run: FluxPgRunner): Promise<string[]> {
  const { rows } = await run.query(
    `
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'v'
    ORDER BY c.relname
    `,
  );
  return (rows as { relname: string }[]).map((r) => r.relname);
}

async function listPublicMatviews(run: FluxPgRunner): Promise<string[]> {
  const { rows } = await run.query(
    `
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'm'
    ORDER BY c.relname
    `,
  );
  return (rows as { relname: string }[]).map((r) => r.relname);
}

/**
 * Moves user tables, sequences, views, and materialized views from `public` into the target
 * API schema, then reapplies grants for that schema.
 *
 * When the dump already created the same object in the target schema, drops the duplicate in `public`
 * (`… CASCADE`) instead of moving.
 *
 * Uses sequential `psql` sessions inside the container (no host TCP). Not wrapped in a single
 * DB transaction — same practical behavior as implicit commits per DDL statement.
 */
export async function movePublicSchemaObjectsToTargetSchema(
  run: FluxPgRunner,
  targetSchema: string,
): Promise<MovePublicToApiResult> {
  assertFluxApiSchemaIdentifier(targetSchema);
  let tablesMoved = 0;
  let sequencesMoved = 0;
  let viewsMoved = 0;

  const baseTables = await listPublicBaseTables(run);
  const fkEdges = await listPublicFkParentChild(run);
  const ordered = orderTablesForMove(baseTables, fkEdges);

  const tSchema = qIdent(targetSchema);
  for (const relname of ordered) {
    if (await targetSchemaHasRelationNamed(run, targetSchema, relname)) {
      await run.query(`DROP TABLE public.${qIdent(relname)} CASCADE`);
    } else {
      await run.query(
        `ALTER TABLE public.${qIdent(relname)} SET SCHEMA ${tSchema}`,
      );
    }
    tablesMoved++;
  }

  const sequences = await listPublicSequences(run);
  for (const relname of sequences) {
    if (await targetSchemaHasRelationNamed(run, targetSchema, relname)) {
      await run.query(`DROP SEQUENCE public.${qIdent(relname)} CASCADE`);
    } else {
      await run.query(
        `ALTER SEQUENCE public.${qIdent(relname)} SET SCHEMA ${tSchema}`,
      );
    }
    sequencesMoved++;
  }

  let progress = true;
  const viewNames = await listPublicViews(run);
  const remainingViews = new Set(viewNames);
  while (progress && remainingViews.size > 0) {
    progress = false;
    for (const v of [...remainingViews].sort()) {
      try {
        if (await targetSchemaHasRelationNamed(run, targetSchema, v)) {
          await run.query(`DROP VIEW public.${qIdent(v)} CASCADE`);
        } else {
          await run.query(`ALTER VIEW public.${qIdent(v)} SET SCHEMA ${tSchema}`);
        }
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
      `Could not move all views from public to ${targetSchema} (remaining: ${names}). ` +
        `Resolve dependencies or move manually.`,
    );
  }

  let matProgress = true;
  const matNames = await listPublicMatviews(run);
  const remainingMat = new Set(matNames);
  while (matProgress && remainingMat.size > 0) {
    matProgress = false;
    for (const relname of [...remainingMat].sort()) {
      try {
        if (await targetSchemaHasRelationNamed(run, targetSchema, relname)) {
          await run.query(
            `DROP MATERIALIZED VIEW public.${qIdent(relname)} CASCADE`,
          );
        } else {
          await run.query(
            `ALTER MATERIALIZED VIEW public.${qIdent(relname)} SET SCHEMA ${tSchema}`,
          );
        }
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

  await run.query(buildApiSchemaPrivilegesSql(targetSchema));

  return { tablesMoved, sequencesMoved, viewsMoved };
}

/** @deprecated Prefer {@link movePublicSchemaObjectsToTargetSchema} with `"api"`. */
export async function movePublicSchemaObjectsToApi(
  run: FluxPgRunner,
): Promise<MovePublicToApiResult> {
  return movePublicSchemaObjectsToTargetSchema(run, "api");
}

export async function runMovePublicSchemaToTargetWithDockerExec(
  docker: Docker,
  containerId: string,
  password: string,
  pgUser: string,
  targetSchema: string,
): Promise<MovePublicToApiResult> {
  const run = createFluxPgRunner(docker, containerId, password, pgUser);
  return movePublicSchemaObjectsToTargetSchema(run, targetSchema);
}

export async function runMovePublicToApiWithDockerExec(
  docker: Docker,
  containerId: string,
  password: string,
  pgUser: string,
): Promise<MovePublicToApiResult> {
  return runMovePublicSchemaToTargetWithDockerExec(
    docker,
    containerId,
    password,
    pgUser,
    "api",
  );
}
