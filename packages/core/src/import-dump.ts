import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Docker from "dockerode";

import { FLUX_AUTH_SCHEMA_AND_UID_SQL } from "./auth-compat-sql.ts";
import { queryPsqlScalar } from "./postgres-internal-exec.ts";

const PG_SUPERUSER = "postgres";

/**
 * Options for {@link preparePlainSqlDumpForFlux} and {@link ProjectManager.importSqlFile}.
 */
export type ImportSqlFileOptions = {
  /**
   * When true (default), remove `SET …` session lines that require a newer PostgreSQL than
   * {@link serverMajor} (e.g. `transaction_timeout` on PG16).
   */
  sanitizeForTarget?: boolean;
  /**
   * When set, skip querying the server and use this major version for sanitization.
   */
  targetMajor?: number;
  /**
   * Insert minimal `auth` schema, `auth.users`, `auth.uid()`, and seed `auth.users` before
   * Supabase-style `REFERENCES auth.users` FKs. Only for dumps that include those FKs.
   */
  supabaseCompat?: boolean;
  /**
   * After import, move tables, sequences, and views from `public` into `api` (Supabase-style
   * layout → Flux PostgREST schema), then re-apply grants on `api`.
   */
  moveFromPublic?: boolean;
  /**
   * After import, disable RLS on every `api` table that has it enabled. Supabase-style dumps often
   * enable RLS with policies that do not match Flux’s `anon` / JWT setup; without this, PostgREST
   * may return empty result sets. Prefer rewriting policies for production; this is for porting
   * and local testing.
   */
  disableRowLevelSecurityInApi?: boolean;
  /** Opaque owner id for Docker-scoped container names (same as `provisionProject` `ownerKey`). */
  ownerKey?: string;
};

const AUTH_PRELUDE = `
-- Flux: minimal Supabase auth stubs (schema + auth.users + auth.uid for RLS)
${FLUX_AUTH_SCHEMA_AND_UID_SQL}

CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);

`;

const SEED_BEFORE_BATCHES_USER_FK = `
-- Flux: seed auth.users so Supabase-style REFERENCES auth.users(id) constraints succeed
INSERT INTO auth.users (id)
SELECT DISTINCT id FROM public.profiles
UNION SELECT DISTINCT user_id FROM public.batches WHERE user_id IS NOT NULL
UNION SELECT DISTINCT user_id FROM public.recipes WHERE user_id IS NOT NULL
ON CONFLICT DO NOTHING;

`;

const BATCHES_USER_FK_MARKER =
  "ALTER TABLE ONLY public.batches\n" +
  "    ADD CONSTRAINT batches_user_id_fkey FOREIGN KEY (user_id) " +
  "REFERENCES auth.users(id) ON DELETE CASCADE;";

const FLUX_PATCH_FOOTER =
  "ALTER DEFAULT PRIVILEGES IN SCHEMA api GRANT ALL ON TABLES TO authenticated;\n\n";

/** Session settings introduced in newer PostgreSQL versions (line must match pg_dump output). */
const SESSION_LINES_MIN_MAJOR: { pattern: RegExp; minMajor: number }[] = [
  {
    pattern: /^SET transaction_timeout\s*=\s*[^;]+;\s*\n?/m,
    minMajor: 17,
  },
];

export type PreparePlainSqlDumpOptions = {
  sql: string;
  serverMajor: number;
  sanitizeForTarget?: boolean;
  supabaseCompat?: boolean;
};

/**
 * Strips `SET` session commands that are not supported by `serverMajor`.
 */
export function sanitizePlainSqlDumpForPostgresMajor(
  sql: string,
  serverMajor: number,
): string {
  let out = sql;
  for (const { pattern, minMajor } of SESSION_LINES_MIN_MAJOR) {
    if (serverMajor < minMajor) {
      out = out.replace(pattern, "");
    }
  }
  return out;
}

/**
 * Supabase / Auth-style dumps: stubs + seed row(s) before the first `auth.users` FK on `batches`.
 */
export function applySupabaseCompatibilityTransforms(sql: string): string {
  if (!sql.includes(BATCHES_USER_FK_MARKER)) {
    throw new Error(
      "Supabase compatibility: expected pg_dump FK block for batches_user_id_fkey → auth.users. " +
        "This dump may not be a Supabase-style plain dump, or the layout changed.",
    );
  }
  let out = sql;
  if (!out.includes(FLUX_PATCH_FOOTER)) {
    throw new Error(
      "Supabase compatibility: could not find Flux migration patch block to insert auth prelude after.",
    );
  }
  out = out.replace(FLUX_PATCH_FOOTER, FLUX_PATCH_FOOTER + AUTH_PRELUDE);
  out = out.replace(
    BATCHES_USER_FK_MARKER,
    SEED_BEFORE_BATCHES_USER_FK + "\n" + BATCHES_USER_FK_MARKER,
  );
  return out;
}

export function preparePlainSqlDumpForFlux(options: PreparePlainSqlDumpOptions): string {
  const sanitize = options.sanitizeForTarget !== false;
  let sql = options.sql;
  if (sanitize) {
    sql = sanitizePlainSqlDumpForPostgresMajor(sql, options.serverMajor);
  }
  if (options.supabaseCompat) {
    sql = applySupabaseCompatibilityTransforms(sql);
  }
  return sql;
}

export async function queryPostgresMajorVersion(
  docker: Docker,
  containerId: string,
  password: string,
): Promise<number> {
  const ver = await queryPsqlScalar(
    docker,
    containerId,
    password,
    `SELECT current_setting('server_version_num')`,
    PG_SUPERUSER,
  );
  const n = Number.parseInt(ver, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("Could not read server_version_num from Postgres.");
  }
  return Math.floor(n / 10000);
}

/**
 * Reads `filePath`, optionally transforms it for Flux, writes a temp file, returns its path.
 * Caller must run `cleanup()` when the temp file is no longer needed.
 */
export async function materializePreparedSqlFile(
  filePath: string,
  options: ImportSqlFileOptions | undefined,
  resolveMajor: () => Promise<number>,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const opts = options ?? {};
  const sanitize = opts.sanitizeForTarget !== false;
  const supabase = opts.supabaseCompat === true;
  if (!sanitize && !supabase) {
    return {
      path: filePath,
      cleanup: async () => {},
    };
  }

  const sql = await readFile(filePath, "utf8");
  const serverMajor = opts.targetMajor ?? (await resolveMajor());
  const prepared = preparePlainSqlDumpForFlux({
    sql,
    serverMajor,
    sanitizeForTarget: sanitize,
    supabaseCompat: supabase,
  });

  if (prepared === sql) {
    return {
      path: filePath,
      cleanup: async () => {},
    };
  }

  const outPath = join(
    tmpdir(),
    `flux-import-${process.pid}-${String(Date.now())}.sql`,
  );
  await writeFile(outPath, prepared, "utf8");
  return {
    path: outPath,
    cleanup: async () => {
      try {
        await unlink(outPath);
      } catch {
        /* ignore */
      }
    },
  };
}
