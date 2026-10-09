/**
 * Restore verification against a real Postgres cluster.
 *
 * Proves a tenant archive that names `t_<id>_ddl` (policy, owner, grant,
 * default privileges, function owner) restores with zero ignored errors, and
 * that a genuinely broken archive still fails.
 *
 * Opt-in, throwaway cluster only:
 *   FLUX_RUN_PG_INTEGRATION=1 \
 *   FLUX_TEST_POSTGRES_URL=postgres://postgres:pw@127.0.0.1:5432/postgres \
 *   pnpm --filter dashboard exec tsx --tsconfig tsconfig.json --test \
 *     src/lib/backup-restore-roles.integration.test.ts
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import pg from "pg";
import {
  defaultTenantApiSchemaFromProjectId,
  defaultTenantDdlRoleFromProjectId,
  defaultTenantRoleFromProjectId,
} from "@flux/core/api-schema-strategy";
import {
  restoreDumpForVerification,
  restoreDumpPreservingOwnership,
  type PgRestoreConnection,
} from "@/src/lib/backup-restore-run";

const execFileAsync = promisify(execFile);

const enabled =
  process.env.FLUX_RUN_PG_INTEGRATION === "1" &&
  Boolean(process.env.FLUX_TEST_POSTGRES_URL);

const PROJECT_ID = "550e8400-e29b-41d4-a716-446655440000";
const SCHEMA = defaultTenantApiSchemaFromProjectId(PROJECT_ID);
const DDL_ROLE = defaultTenantDdlRoleFromProjectId(PROJECT_ID);
const RUNTIME_ROLE = defaultTenantRoleFromProjectId(PROJECT_ID);
const DB_NAME = "flux_bvr_it";
const NO_CITEXT_DB = "flux_bvr_nocitext";

function adminUrl(): URL {
  return new URL(process.env.FLUX_TEST_POSTGRES_URL as string);
}

function connection(database: string): PgRestoreConnection {
  const url = adminUrl();
  return {
    host: url.hostname || "127.0.0.1",
    port: url.port || "5432",
    user: decodeURIComponent(url.username || "postgres"),
    password: decodeURIComponent(url.password),
    database,
  };
}

async function connect(database: string): Promise<pg.Client> {
  const url = adminUrl();
  url.pathname = `/${database}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  return client;
}

async function dropRole(client: pg.Client, role: string): Promise<void> {
  await client.query(
    `
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${role}') THEN
        EXECUTE 'DROP OWNED BY ${role}';
        EXECUTE 'DROP ROLE ${role}';
      END IF;
    END $$;
    `,
  );
}

async function resetTenant(client: pg.Client): Promise<void> {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await dropRole(client, DDL_ROLE);
  await dropRole(client, RUNTIME_ROLE);
}

function pgEnv(conn: PgRestoreConnection): NodeJS.ProcessEnv {
  return { ...process.env, PGPASSWORD: conn.password };
}

async function dumpSchema(
  conn: PgRestoreConnection,
  outPath: string,
  flags: string[],
): Promise<void> {
  await execFileAsync(
    "pg_dump",
    [
      "-h",
      conn.host,
      "-p",
      conn.port,
      "-U",
      conn.user,
      "-d",
      conn.database,
      "--schema",
      SCHEMA,
      ...flags,
      "--format",
      "custom",
      "-f",
      outPath,
    ],
    { env: pgEnv(conn) },
  );
}

async function policyRoles(client: pg.Client): Promise<string[]> {
  const result = await client.query<{ rolname: string }>(
    `
    SELECT r.rolname
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles r ON r.oid = ANY (pol.polroles)
    WHERE n.nspname = $1
      AND c.relname = 'organization_members'
      AND pol.polname = 'organization_members_definer_select'
    ORDER BY r.rolname
    `,
    [SCHEMA],
  );
  return result.rows.map((row) => row.rolname);
}

async function tableOwner(client: pg.Client): Promise<string> {
  const result = await client.query<{ tableowner: string }>(
    `SELECT tableowner FROM pg_tables WHERE schemaname = $1 AND tablename = 'organization_members'`,
    [SCHEMA],
  );
  return result.rows[0]?.tableowner ?? "";
}

async function functionOwner(client: pg.Client): Promise<string> {
  const result = await client.query<{ owner: string }>(
    `
    SELECT r.rolname AS owner
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
    WHERE n.nspname = $1 AND p.proname = 'definer_count'
    `,
    [SCHEMA],
  );
  return result.rows[0]?.owner ?? "";
}

test(
  "backup restore keeps policies that name the tenant ddl role",
  { skip: !enabled },
  async (t) => {
    const admin = await connect(adminUrl().pathname.replace(/^\//u, "") || "postgres");
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    await admin.query(`DROP DATABASE IF EXISTS ${NO_CITEXT_DB}`);
    await admin.query(`CREATE DATABASE ${DB_NAME}`);
    await admin.query(`CREATE DATABASE ${NO_CITEXT_DB}`);
    const db = await connect(DB_NAME);
    const conn = connection(DB_NAME);
    const dir = await mkdtemp(path.join(tmpdir(), "flux-bvr-"));
    const noAclDump = path.join(dir, "noacl.dump");
    const fullDump = path.join(dir, "full.dump");
    const citextDump = path.join(dir, "citext.dump");

    t.after(async () => {
      await db.end().catch(() => {});
      const cleanup = await connect(adminUrl().pathname.replace(/^\//u, "") || "postgres");
      await cleanup.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
      await cleanup.query(`DROP DATABASE IF EXISTS ${NO_CITEXT_DB}`);
      await dropRole(cleanup, DDL_ROLE).catch(() => {});
      await dropRole(cleanup, RUNTIME_ROLE).catch(() => {});
      await cleanup.end();
      await admin.end();
    });

    await resetTenant(db);
    await db.query(`
      CREATE ROLE ${DDL_ROLE} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      CREATE ROLE ${RUNTIME_ROLE} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      CREATE SCHEMA ${SCHEMA} AUTHORIZATION ${DDL_ROLE};
      GRANT USAGE ON SCHEMA ${SCHEMA} TO ${RUNTIME_ROLE};
    `);
    await db.query(`
      SET ROLE ${DDL_ROLE};
      SET search_path TO ${SCHEMA};
      CREATE TABLE organization_members (
        id int PRIMARY KEY,
        user_id text NOT NULL
      );
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE organization_members TO ${RUNTIME_ROLE};
      CREATE POLICY organization_members_definer_select ON organization_members
        FOR SELECT TO ${DDL_ROLE} USING (true);
      ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
      ALTER TABLE organization_members FORCE ROW LEVEL SECURITY;
      CREATE FUNCTION definer_count() RETURNS int
        LANGUAGE sql SECURITY DEFINER
        AS $$ SELECT count(*)::int FROM organization_members $$;
      ALTER DEFAULT PRIVILEGES IN SCHEMA ${SCHEMA}
        GRANT SELECT ON TABLES TO ${RUNTIME_ROLE};
      RESET ROLE;
    `);

    await dumpSchema(conn, noAclDump, ["--no-owner", "--no-acl"]);
    await dumpSchema(conn, fullDump, []);

    let citextAvailable = true;
    try {
      await db.query("RESET ROLE");
      await db.query("SET search_path TO public");
      await db.query("CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public");
      await db.query(
        `CREATE TABLE ${SCHEMA}.emails (id int, email public.citext)`,
      );
      await dumpSchema(conn, citextDump, ["--no-owner", "--no-acl"]);
    } catch {
      citextAvailable = false;
    }

    await resetTenant(db);

    await t.test("verify path restores the ddl policy with zero ignored errors", async () => {
      const result = await restoreDumpForVerification({
        dumpPath: noAclDump,
        projectId: PROJECT_ID,
        kind: "tenant_export",
        connection: conn,
      });
      assert.doesNotMatch(result.stderr, /errors ignored on restore:\s*[1-9]/u);
      assert.deepEqual(await policyRoles(db), [DDL_ROLE]);
      assert.equal(await tableOwner(db), "postgres");
      assert.equal(await functionOwner(db), "postgres");
      const bypass = await db.query<{ rolbypassrls: boolean; rolcanlogin: boolean }>(
        `SELECT rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = $1`,
        [DDL_ROLE],
      );
      assert.equal(bypass.rows[0]?.rolbypassrls, false);
      assert.equal(bypass.rows[0]?.rolcanlogin, false);
    });

    await resetTenant(db);

    await t.test("live restore keeps owners from a flux-style custom archive", async () => {
      const result = await restoreDumpPreservingOwnership({
        dumpPath: noAclDump,
        projectId: PROJECT_ID,
        connection: conn,
      });
      assert.doesNotMatch(result.stderr, /errors ignored on restore:\s*[1-9]/u);
      assert.deepEqual(await policyRoles(db), [DDL_ROLE]);
      assert.equal(await tableOwner(db), DDL_ROLE);
      assert.equal(await functionOwner(db), DDL_ROLE);
    });

    await resetTenant(db);

    await t.test("live restore keeps grants and default privileges", async () => {
      const result = await restoreDumpPreservingOwnership({
        dumpPath: fullDump,
        projectId: PROJECT_ID,
        connection: conn,
      });
      assert.doesNotMatch(result.stderr, /errors ignored on restore:\s*[1-9]/u);
      assert.deepEqual(await policyRoles(db), [DDL_ROLE]);
      const grant = await db.query<{ ok: boolean }>(
        `SELECT has_table_privilege($1, $2, 'INSERT') AS ok`,
        [RUNTIME_ROLE, `${SCHEMA}.organization_members`],
      );
      assert.equal(grant.rows[0]?.ok, true);
      const defaults = await db.query<{ acl: string | null }>(
        `
        SELECT defaclacl::text AS acl
        FROM pg_default_acl
        WHERE defaclnamespace = $1::regnamespace
          AND defaclrole = $2::regrole
        `,
        [SCHEMA, DDL_ROLE],
      );
      assert.match(
        defaults.rows.map((row) => row.acl ?? "").join("\n"),
        new RegExp(RUNTIME_ROLE),
      );
    });

    await resetTenant(db);

    await t.test("truncated archive still fails verification", async () => {
      const bytes = await readFile(noAclDump);
      const broken = path.join(dir, "truncated.dump");
      await writeFile(broken, bytes.subarray(0, 32));
      await assert.rejects(
        () =>
          restoreDumpForVerification({
            dumpPath: broken,
            projectId: PROJECT_ID,
            kind: "tenant_export",
            connection: conn,
          }),
        /pg_restore failed/u,
      );
      const policies = await db.query<{ n: string }>(
        `
        SELECT count(*)::text AS n
        FROM pg_policy pol
        JOIN pg_class c ON c.oid = pol.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1
        `,
        [SCHEMA],
      );
      assert.equal(policies.rows[0]?.n ?? "0", "0");
    });

    await t.test(
      "missing type still fails after role stubs",
      { skip: !citextAvailable },
      async () => {
        const bare = connection(NO_CITEXT_DB);
        await assert.rejects(
          () =>
            restoreDumpForVerification({
              dumpPath: citextDump,
              projectId: PROJECT_ID,
              kind: "project_db",
              connection: bare,
            }),
          /pg_restore failed/u,
        );
      },
    );
  },
);
