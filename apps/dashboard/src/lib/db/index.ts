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
    await pm.provisionProject("flux-system", {
      isProduction: process.env.NODE_ENV === "production",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("already exists")) throw err;
    try {
      await pm.startProject("flux-system");
    } catch {
      // 304: already running — safe to ignore
    }
  }

  const connectionString =
    process.env.FLUX_SYSTEM_DATABASE_URL?.trim() ||
    (await pm.getPostgresHostConnectionString("flux-system"));
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
      slug TEXT NOT NULL UNIQUE,
      "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
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
