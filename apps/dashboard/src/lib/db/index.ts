import { FLUX_SYSTEM_HASH } from "@flux/core";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../db/schema";
import { getProjectManager } from "../flux";

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
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

async function _init(): Promise<void> {
  const pm = getProjectManager();

  try {
    await pm.provisionProject(
      "flux-system",
      { isProduction: process.env.NODE_ENV === "production" },
      FLUX_SYSTEM_HASH,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("already exists")) throw err;
    try {
      await pm.startProject("flux-system", FLUX_SYSTEM_HASH);
    } catch {
      // 304: already running — safe to ignore
    }
  }

  const connectionString =
    process.env.FLUX_SYSTEM_DATABASE_URL?.trim() ||
    (await pm.getPostgresHostConnectionString("flux-system", FLUX_SYSTEM_HASH));
  const pool = new Pool({ connectionString });

  // One-time upgrade from the pre–Auth.js v5 UUID user model to Auth.js string ids.
  await pool.query(`
    DO $migrate$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'id'
          AND udt_name = 'uuid'
      ) THEN
        DROP TABLE IF EXISTS projects CASCADE;
        DROP TABLE IF EXISTS sessions CASCADE;
        DROP TABLE IF EXISTS accounts CASCADE;
        DROP TABLE IF EXISTS authenticators CASCADE;
        DROP TABLE IF EXISTS verification_tokens CASCADE;
        DROP TABLE IF EXISTS users CASCADE;
      END IF;
    END
    $migrate$;
  `);

  // Clean-cutover migration for global hash namespacing: pre-production only.
  // If the legacy projects table exists without the `hash` column, drop it so the CREATE TABLE
  // below installs the new shape (no backfill — rows would have no Docker/Traefik names).
  await pool.query(`
    DO $cutover$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'projects'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'hash'
      ) THEN
        DROP TABLE projects CASCADE;
      END IF;
    END
    $cutover$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT UNIQUE,
      "emailVerified" TIMESTAMPTZ,
      image TEXT,
      plan TEXT NOT NULL DEFAULT 'hobby',
      "stripeCustomerId" TEXT,
      "stripeSubscriptionId" TEXT
    );

    CREATE TABLE IF NOT EXISTS accounts (
      "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      provider TEXT NOT NULL,
      "providerAccountId" TEXT NOT NULL,
      refresh_token TEXT,
      access_token TEXT,
      expires_at INTEGER,
      token_type TEXT,
      scope TEXT,
      id_token TEXT,
      session_state TEXT,
      PRIMARY KEY (provider, "providerAccountId")
    );

    CREATE TABLE IF NOT EXISTS sessions (
      "sessionToken" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS verification_tokens (
      identifier TEXT NOT NULL,
      token TEXT NOT NULL,
      expires TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (identifier, token)
    );

    CREATE TABLE IF NOT EXISTS authenticators (
      "credentialID" TEXT NOT NULL UNIQUE,
      "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "providerAccountId" TEXT NOT NULL,
      "credentialPublicKey" TEXT NOT NULL,
      counter INTEGER NOT NULL,
      "credentialDeviceType" TEXT NOT NULL,
      "credentialBackedUp" BOOLEAN NOT NULL,
      transports TEXT,
      PRIMARY KEY ("userId", "credentialID")
    );

    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      hash TEXT NOT NULL,
      "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS projects_user_slug_uniq ON projects ("userId", slug);
  `);

  await pool.query(`
    DO $rename$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'projects'
          AND column_name = 'last_active_at'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'projects'
          AND column_name = 'last_accessed_at'
      ) THEN
        ALTER TABLE projects RENAME COLUMN last_active_at TO last_accessed_at;
      END IF;
    END
    $rename$;
  `);

  await pool.query(`
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ;
    UPDATE projects SET last_accessed_at = created_at WHERE last_accessed_at IS NULL;
    ALTER TABLE projects ALTER COLUMN last_accessed_at SET DEFAULT NOW();
    ALTER TABLE projects ALTER COLUMN last_accessed_at SET NOT NULL;
  `);

  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'hobby';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" TEXT;
  `);

  await pool.query(`
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS health_status TEXT;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_heartbeat_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      health_status TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS project_heartbeat_log_project_time_idx
      ON project_heartbeat_log (project_id, recorded_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS flux_api_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'Default Key',
      key_prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS flux_api_keys_user_id_idx ON flux_api_keys (user_id);
  `);

  // v2: execution engine mode per project (v1_dedicated | v2_shared).
  await pool.query(`
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'v1_dedicated';
  `);

  await pool.query(`
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS jwt_secret TEXT;
  `);

  // New projects default to pooled Standard stack; existing rows keep prior mode.
  await pool.query(`
    ALTER TABLE projects ALTER COLUMN mode SET DEFAULT 'v2_shared';
  `);

  // v2: custom-domain → project mapping used by the gateway for tenant resolution.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS domains (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hostname   TEXT NOT NULL UNIQUE,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS domains_project_id_idx ON domains (project_id);
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
