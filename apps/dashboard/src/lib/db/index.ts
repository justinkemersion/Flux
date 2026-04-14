import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getProjectManager } from "../flux";
import * as schema from "./schema";

export type SystemDb = ReturnType<typeof drizzle<typeof schema>>;

let db: SystemDb | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Idempotent — returns the same promise on concurrent calls.
 * Provisions the flux-system project (Postgres + PostgREST), connects,
 * and creates the platform schema tables.
 */
export function initSystemDb(): Promise<void> {
  if (!initPromise) {
    initPromise = _init().catch((err) => {
      // Reset so the next call retries
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

async function _init(): Promise<void> {
  const pm = getProjectManager();

  // Provision the system project (idempotent — start it if stopped, skip if running)
  try {
    await pm.provisionProject("flux-system");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("already exists")) throw err;
    // Already exists — ensure it's running
    try {
      await pm.startProject("flux-system");
    } catch {
      // 304: already running — safe to ignore
    }
  }

  const connectionString =
    await pm.getPostgresHostConnectionString("flux-system");
  const pool = new Pool({ connectionString });

  // Create platform schema tables idempotently
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT,
      email       TEXT        NOT NULL UNIQUE,
      image       TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS accounts (
      provider             TEXT NOT NULL,
      provider_account_id  TEXT NOT NULL,
      user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type                 TEXT NOT NULL,
      access_token         TEXT,
      refresh_token        TEXT,
      expires_at           INTEGER,
      token_type           TEXT,
      scope                TEXT,
      id_token             TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (provider, provider_account_id)
    );

    CREATE TABLE IF NOT EXISTS projects (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT        NOT NULL,
      slug        TEXT        NOT NULL UNIQUE,
      user_id     UUID        NOT NULL REFERENCES users(id),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  db = drizzle(pool, { schema });
}

/** Synchronous getter — throws if {@link initSystemDb} has not been awaited. */
export function getDb(): SystemDb {
  if (!db) {
    throw new Error(
      "[flux] System DB not initialised. Ensure initSystemDb() is awaited first.",
    );
  }
  return db;
}
