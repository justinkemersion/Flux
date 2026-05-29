import type { Pool } from "pg";

/** Ledger rows — destructive catalog cutovers run at most once when explicitly allowed. */
export const CUTOVER_AUTHJS_V5_UUID = "authjs_v5_uuid_to_text";
export const CUTOVER_PROJECTS_HASH_NAMESPACE = "projects_hash_namespace";

const LEDGER_DDL = `
  CREATE TABLE IF NOT EXISTS flux_system_cutovers (
    id TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    note TEXT
  );
`;

/**
 * When true, legacy one-time DROP cutovers in `system-db-bootstrap.ts` may run.
 * Default off — production control planes stay additive on restart.
 */
export function destructiveCutoverAllowed(): boolean {
  const v = process.env.FLUX_SYSTEM_DB_ALLOW_DESTRUCTIVE_CUTOVER?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export async function ensureCutoverLedger(pool: Pool): Promise<void> {
  await pool.query(LEDGER_DDL);
}

export async function isCutoverApplied(pool: Pool, id: string): Promise<boolean> {
  await ensureCutoverLedger(pool);
  const res = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM flux_system_cutovers WHERE id = $1) AS exists`,
    [id],
  );
  return res.rows[0]?.exists === true;
}

export async function recordCutoverApplied(
  pool: Pool,
  id: string,
  note?: string,
): Promise<void> {
  await ensureCutoverLedger(pool);
  await pool.query(
    `INSERT INTO flux_system_cutovers (id, note) VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [id, note ?? null],
  );
}

function warnSkippedCutover(id: string, detail: string): void {
  console.warn(
    `[flux-system-db] Skipped destructive cutover "${id}": ${detail}. ` +
      "Set FLUX_SYSTEM_DB_ALLOW_DESTRUCTIVE_CUTOVER=1 and restart to apply once, " +
      "or run additive migrations manually.",
  );
}

/**
 * Auth.js v4 UUID user ids → v5 text ids. Drops catalog auth/projects tables when legacy shape remains.
 */
export async function runAuthJsUuidToTextCutover(pool: Pool): Promise<void> {
  if (await isCutoverApplied(pool, CUTOVER_AUTHJS_V5_UUID)) return;

  const detect = await pool.query<{ legacy: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'id'
        AND udt_name = 'uuid'
    ) AS legacy
  `);
  if (detect.rows[0]?.legacy !== true) return;

  if (!destructiveCutoverAllowed()) {
    warnSkippedCutover(
      CUTOVER_AUTHJS_V5_UUID,
      "users.id is still UUID (pre–Auth.js v5)",
    );
    return;
  }

  await pool.query(`
    DROP TABLE IF EXISTS projects CASCADE;
    DROP TABLE IF EXISTS sessions CASCADE;
    DROP TABLE IF EXISTS accounts CASCADE;
    DROP TABLE IF EXISTS authenticators CASCADE;
    DROP TABLE IF EXISTS verification_tokens CASCADE;
    DROP TABLE IF EXISTS users CASCADE;
  `);
  await recordCutoverApplied(
    pool,
    CUTOVER_AUTHJS_V5_UUID,
    "Dropped legacy UUID users and dependent catalog tables",
  );
}

/**
 * Pre-hash `projects` table → hash-namespaced shape. Drops projects when `hash` column is missing.
 */
export async function runProjectsHashNamespaceCutover(pool: Pool): Promise<void> {
  if (await isCutoverApplied(pool, CUTOVER_PROJECTS_HASH_NAMESPACE)) return;

  const detect = await pool.query<{ legacy: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'projects'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'hash'
    ) AS legacy
  `);
  if (detect.rows[0]?.legacy !== true) return;

  if (!destructiveCutoverAllowed()) {
    warnSkippedCutover(
      CUTOVER_PROJECTS_HASH_NAMESPACE,
      "projects exists without hash column",
    );
    return;
  }

  await pool.query(`DROP TABLE projects CASCADE`);
  await recordCutoverApplied(
    pool,
    CUTOVER_PROJECTS_HASH_NAMESPACE,
    "Dropped pre-hash projects table",
  );
}
