/**
 * **flux-system** catalog bootstrap: idempotent DDL and data fixes for the dashboard’s
 * system Postgres (Auth.js tables, `projects`, domains, backups, API keys, etc.).
 *
 * **Migration-sensitive.** This runs automatically after the app connects to `flux-system`
 * (see `initSystemDb` in `index.ts`). Assume every change hits existing production and
 * staging databases on the next deploy or process restart. Prefer additive,
 * backwards-compatible steps (`CREATE … IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
 * guarded `DO $$ … $$` blocks). Do not drop or rename columns casually; destructive or
 * reorder-dependent SQL needs an explicit rollout plan and operator communication.
 * Longer-term, consider versioned migrations instead of only extending this file.
 *
 * Contributor map: [README.md](../../../../../README.md) → **Code ownership map**.
 */
import type { Pool } from "pg";

/** Runs all bootstrap queries; constraints and operator notes are in the file header above. */
export async function runSystemDbBootstrap(pool: Pool): Promise<void> {
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

  await pool.query(`
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS migration_status TEXT;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS api_schema_name TEXT;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS api_schema_strategy TEXT;
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_backups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'project_db',
      format TEXT NOT NULL DEFAULT 'pg_custom',
      local_path TEXT NOT NULL,
      size_bytes INTEGER,
      checksum_sha256 TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      completed_at TIMESTAMPTZ,
      error TEXT,
      offsite_status TEXT NOT NULL DEFAULT 'pending',
      offsite_key TEXT,
      offsite_completed_at TIMESTAMPTZ,
      offsite_error TEXT,
      artifact_validation_status TEXT NOT NULL DEFAULT 'pending',
      artifact_validation_at TIMESTAMPTZ,
      artifact_validation_error TEXT,
      restore_verification_status TEXT NOT NULL DEFAULT 'pending',
      restore_verification_at TIMESTAMPTZ,
      restore_verification_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS project_backups_project_created_idx
      ON project_backups (project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS project_backups_status_idx
      ON project_backups (status, created_at DESC);
    CREATE INDEX IF NOT EXISTS project_backups_offsite_status_idx
      ON project_backups (offsite_status, created_at DESC);
    -- project_backups_project_kind_created_idx is created below, after ADD COLUMN kind,
    -- so upgrades from pre-2026 schemas (no kind column) do not hit "column does not exist".
  `);

  await pool.query(`
    ALTER TABLE project_backups ADD COLUMN IF NOT EXISTS format TEXT;
    ALTER TABLE project_backups ADD COLUMN IF NOT EXISTS local_path TEXT;
    ALTER TABLE project_backups ADD COLUMN IF NOT EXISTS size_bytes INTEGER;
    ALTER TABLE project_backups ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT;
    ALTER TABLE project_backups ADD COLUMN IF NOT EXISTS status TEXT;
    ALTER TABLE project_backups ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
    ALTER TABLE project_backups ADD COLUMN IF NOT EXISTS error TEXT;
    ALTER TABLE project_backups ADD COLUMN IF NOT EXISTS offsite_status TEXT;
    ALTER TABLE project_backups ADD COLUMN IF NOT EXISTS offsite_key TEXT;
    ALTER TABLE project_backups ADD COLUMN IF NOT EXISTS offsite_completed_at TIMESTAMPTZ;
    ALTER TABLE project_backups ADD COLUMN IF NOT EXISTS offsite_error TEXT;
    ALTER TABLE project_backups ADD COLUMN IF NOT EXISTS artifact_validation_status TEXT;
    ALTER TABLE project_backups ADD COLUMN IF NOT EXISTS artifact_validation_at TIMESTAMPTZ;
    ALTER TABLE project_backups ADD COLUMN IF NOT EXISTS artifact_validation_error TEXT;
    ALTER TABLE project_backups ADD COLUMN IF NOT EXISTS restore_verification_status TEXT;
    ALTER TABLE project_backups ADD COLUMN IF NOT EXISTS restore_verification_at TIMESTAMPTZ;
    ALTER TABLE project_backups ADD COLUMN IF NOT EXISTS restore_verification_error TEXT;
    ALTER TABLE project_backups ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
    UPDATE project_backups SET format = 'pg_custom' WHERE format IS NULL;
    UPDATE project_backups SET status = 'queued' WHERE status IS NULL;
    UPDATE project_backups SET offsite_status = 'pending' WHERE offsite_status IS NULL;
    UPDATE project_backups SET artifact_validation_status = 'pending' WHERE artifact_validation_status IS NULL;
    UPDATE project_backups SET restore_verification_status = 'pending' WHERE restore_verification_status IS NULL;
    UPDATE project_backups SET artifact_validation_status = 'artifact_valid'
      WHERE artifact_validation_status IN ('artifact_verified');
    UPDATE project_backups SET artifact_validation_status = 'artifact_invalid'
      WHERE artifact_validation_status IN ('failed');
    UPDATE project_backups SET artifact_validation_status = 'pending'
      WHERE artifact_validation_status IN ('running');
    UPDATE project_backups SET restore_verification_status = 'restore_failed'
      WHERE restore_verification_status IN ('failed');
    UPDATE project_backups SET restore_verification_status = 'pending'
      WHERE restore_verification_status IN ('running');
    UPDATE project_backups SET created_at = NOW() WHERE created_at IS NULL;
    ALTER TABLE project_backups ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'project_db';
    UPDATE project_backups SET kind = 'project_db' WHERE kind IS NULL;
    ALTER TABLE project_backups DROP CONSTRAINT IF EXISTS project_backups_kind_check;
    ALTER TABLE project_backups ADD CONSTRAINT project_backups_kind_check
      CHECK (kind IN ('project_db', 'tenant_export'));
    CREATE INDEX IF NOT EXISTS project_backups_project_kind_created_idx
      ON project_backups (project_id, kind, created_at DESC);
    ALTER TABLE project_backups ALTER COLUMN format SET DEFAULT 'pg_custom';
    ALTER TABLE project_backups ALTER COLUMN format SET NOT NULL;
    ALTER TABLE project_backups ALTER COLUMN status SET DEFAULT 'queued';
    ALTER TABLE project_backups ALTER COLUMN status SET NOT NULL;
    ALTER TABLE project_backups ALTER COLUMN offsite_status SET DEFAULT 'pending';
    ALTER TABLE project_backups ALTER COLUMN offsite_status SET NOT NULL;
    ALTER TABLE project_backups ALTER COLUMN artifact_validation_status SET DEFAULT 'pending';
    ALTER TABLE project_backups ALTER COLUMN artifact_validation_status SET NOT NULL;
    ALTER TABLE project_backups ALTER COLUMN restore_verification_status SET DEFAULT 'pending';
    ALTER TABLE project_backups ALTER COLUMN restore_verification_status SET NOT NULL;
    ALTER TABLE project_backups ALTER COLUMN created_at SET DEFAULT NOW();
    ALTER TABLE project_backups ALTER COLUMN created_at SET NOT NULL;
  `);

  await pool.query(`
    DO $migrate_backup_semantics$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'project_backups'
          AND column_name = 'restore_test_status'
      ) THEN
        UPDATE project_backups
        SET
          artifact_validation_status = COALESCE(artifact_validation_status, restore_test_status),
          artifact_validation_at = COALESCE(artifact_validation_at, restore_test_at),
          artifact_validation_error = COALESCE(artifact_validation_error, restore_test_error)
        WHERE artifact_validation_status IS NULL
           OR artifact_validation_at IS NULL
           OR artifact_validation_error IS NULL;
      END IF;
    END
    $migrate_backup_semantics$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS backup_locks (
      lock_key TEXT PRIMARY KEY,
      operation TEXT NOT NULL,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      backup_id UUID REFERENCES project_backups(id) ON DELETE CASCADE,
      claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS backup_locks_expires_idx ON backup_locks (expires_at);
  `);

  await pool.query(`
    ALTER TABLE backup_locks ADD COLUMN IF NOT EXISTS operation TEXT;
    ALTER TABLE backup_locks ADD COLUMN IF NOT EXISTS project_id UUID;
    ALTER TABLE backup_locks ADD COLUMN IF NOT EXISTS backup_id UUID;
    ALTER TABLE backup_locks ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
    ALTER TABLE backup_locks ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
    UPDATE backup_locks SET claimed_at = NOW() WHERE claimed_at IS NULL;
    ALTER TABLE backup_locks ALTER COLUMN operation SET NOT NULL;
    ALTER TABLE backup_locks ALTER COLUMN project_id SET NOT NULL;
    ALTER TABLE backup_locks ALTER COLUMN claimed_at SET DEFAULT NOW();
    ALTER TABLE backup_locks ALTER COLUMN claimed_at SET NOT NULL;
    ALTER TABLE backup_locks ALTER COLUMN expires_at SET NOT NULL;
  `);
}
