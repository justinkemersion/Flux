/**
 * Dedicated v1 push security — real-Postgres verification of the transaction
 * boundary in issue #8.
 *
 * Unit tests prove classification. This file proves the generated SQL rolls
 * back user DDL and the migration ledger together when unrestricted writes
 * exist, and that `has_table_privilege` sees inherited / PUBLIC / direct grants.
 *
 * Opt-in:
 *   FLUX_RUN_PG_INTEGRATION=1 \
 *   FLUX_TEST_POSTGRES_URL=postgres://postgres:pw@127.0.0.1:5433/postgres \
 *   pnpm --filter dashboard test
 *
 * Point this at a throwaway cluster, never production.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import {
  buildDedicatedPushTransactionSql,
  buildInspectExposedTableSecuritySql,
  classifyExposedSchemaSecurity,
  parseExposedTableSecurityFacts,
} from "@flux/core";
import { buildMigrationPushSql } from "@flux/core/sql-migrations";

const execFileAsync = promisify(execFile);

const enabled =
  process.env.FLUX_RUN_PG_INTEGRATION === "1" &&
  Boolean(process.env.FLUX_TEST_POSTGRES_URL);

const SCHEMA = "flux_i8_api";

async function runPsqlScript(sql: string): Promise<void> {
  const url = new URL(process.env.FLUX_TEST_POSTGRES_URL as string);
  const args = [
    "-v",
    "ON_ERROR_STOP=1",
    "-d",
    decodeURIComponent(url.pathname.replace(/^\//u, "") || "postgres"),
    "-h",
    url.hostname || "127.0.0.1",
    "-p",
    url.port || "5432",
    "-U",
    decodeURIComponent(url.username || "postgres"),
    "-c",
    sql,
  ];
  try {
    await execFileAsync("psql", args, {
      env: {
        ...process.env,
        PGPASSWORD: decodeURIComponent(url.password),
      },
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    throw new Error(e.stderr || e.stdout || e.message || String(err));
  }
}

async function connect(): Promise<pg.Client> {
  const client = new pg.Client({
    connectionString: process.env.FLUX_TEST_POSTGRES_URL,
  });
  await client.connect();
  return client;
}

async function reset(client: pg.Client): Promise<void> {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.query(`DROP SCHEMA IF EXISTS flux CASCADE`);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flux_i8_writer') THEN
        CREATE ROLE flux_i8_writer NOLOGIN;
      END IF;
    END
    $$;
  `);
  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_auth_members m
                 JOIN pg_roles r ON r.oid = m.roleid
                 JOIN pg_roles u ON u.oid = m.member
                 WHERE r.rolname = 'flux_i8_writer' AND u.rolname = 'anon') THEN
        EXECUTE 'REVOKE flux_i8_writer FROM anon';
      END IF;
    END
    $$;
  `);
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO anon, authenticated, PUBLIC`);
}

function migrationSql(userSql: string, version: string): string {
  const wrappedUser = buildMigrationPushSql({
    tenantSchema: SCHEMA,
    userSql,
    migration: {
      version,
      filename: version,
      checksum: `checksum-${version}`,
    },
  });
  return buildDedicatedPushTransactionSql({
    searchPath: `${SCHEMA}, public`,
    userSql: wrappedUser,
    apiSchema: SCHEMA,
  });
}

async function inspect(client: pg.Client) {
  const result = await client.query(buildInspectExposedTableSecuritySql(SCHEMA));
  return classifyExposedSchemaSecurity(parseExposedTableSecurityFacts(result.rows));
}

async function ledgerCount(client: pg.Client): Promise<number> {
  const exists = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'flux' AND table_name = 'flux_migrations'
     ) AS exists`,
  );
  if (!exists.rows[0]?.exists) return 0;
  const rows = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM flux.flux_migrations WHERE tenant_schema = $1`,
    [SCHEMA],
  );
  return Number(rows.rows[0]?.n ?? 0);
}

test(
  "dedicated exposed-table security (requires FLUX_RUN_PG_INTEGRATION=1)",
  { skip: !enabled },
  async (t) => {
    const client = await connect();
    t.after(async () => {
      try {
        await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
        await client.query(`REVOKE flux_i8_writer FROM anon`);
      } catch {
        /* ignore cleanup races */
      }
      await client.end();
    });

    await t.test("rejects anon-writable RLS-disabled table and rolls back ledger", async () => {
      await reset(client);
      const sql = migrationSql(
        `
CREATE TABLE ${SCHEMA}.mail_categories (id int);
GRANT SELECT, INSERT, UPDATE, DELETE ON ${SCHEMA}.mail_categories TO anon, authenticated;
        `.trim(),
        "003_mail_categories.sql",
      );
      await assert.rejects(
        () => runPsqlScript(sql),
        (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          assert.match(msg, /Refusing push: unrestricted write/u);
          assert.match(msg, /mail_categories/u);
          assert.match(msg, /anon|authenticated|PUBLIC/u);
          return true;
        },
      );
      const tables = await client.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = $1 AND table_name = 'mail_categories'`,
        [SCHEMA],
      );
      assert.equal(tables.rowCount, 0, "unsafe table must not survive rollback");
      assert.equal(await ledgerCount(client), 0, "ledger must not advance");
    });

    await t.test("detects inherited write privileges", async () => {
      await reset(client);
      await client.query(`
        CREATE TABLE ${SCHEMA}.events (id int);
        GRANT INSERT ON ${SCHEMA}.events TO flux_i8_writer;
        GRANT flux_i8_writer TO anon;
      `);
      const report = await inspect(client);
      const finding = report.findings.find((f) => f.table === "events");
      assert.equal(finding?.severity, "fail");
      assert.ok(
        finding?.privileges.some(
          (p) => p.role === "anon" && p.privilege === "INSERT" && p.sources.includes("inherited"),
        ),
        JSON.stringify(finding?.privileges),
      );
    });

    await t.test("detects PUBLIC write privileges", async () => {
      await reset(client);
      await client.query(`
        CREATE TABLE ${SCHEMA}.docs (id int);
        GRANT INSERT ON ${SCHEMA}.docs TO PUBLIC;
      `);
      const report = await inspect(client);
      const finding = report.findings.find((f) => f.table === "docs");
      assert.equal(finding?.severity, "fail");
      assert.ok(
        finding?.privileges.some(
          (p) => p.role === "PUBLIC" && p.privilege === "INSERT",
        ),
        JSON.stringify(finding?.privileges),
      );
    });

    await t.test("detects direct grants", async () => {
      await reset(client);
      await client.query(`
        CREATE TABLE ${SCHEMA}.direct_tab (id int);
        GRANT DELETE ON ${SCHEMA}.direct_tab TO authenticated;
      `);
      const report = await inspect(client);
      const finding = report.findings.find((f) => f.table === "direct_tab");
      assert.equal(finding?.severity, "fail");
      assert.ok(
        finding?.privileges.some(
          (p) =>
            p.role === "authenticated" &&
            p.privilege === "DELETE" &&
            p.sources.includes("direct"),
        ),
        JSON.stringify(finding?.privileges),
      );
    });

    await t.test("RLS enabled with policies passes and records the ledger", async () => {
      await reset(client);
      const sql = migrationSql(
        `
CREATE TABLE ${SCHEMA}.notes (id int, owner text);
ALTER TABLE ${SCHEMA}.notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY notes_owner ON ${SCHEMA}.notes
  USING (owner = current_user)
  WITH CHECK (owner = current_user);
GRANT SELECT, INSERT, UPDATE, DELETE ON ${SCHEMA}.notes TO authenticated;
        `.trim(),
        "001_notes.sql",
      );
      await runPsqlScript(sql);
      assert.equal(await ledgerCount(client), 1);
      const report = await inspect(client);
      assert.equal(report.overall, "pass");
    });

    await t.test("RLS enabled with zero policies warns but does not block", async () => {
      await reset(client);
      const sql = migrationSql(
        `
CREATE TABLE ${SCHEMA}.queue (id int);
ALTER TABLE ${SCHEMA}.queue ENABLE ROW LEVEL SECURITY;
        `.trim(),
        "002_queue.sql",
      );
      await runPsqlScript(sql);
      assert.equal(await ledgerCount(client), 1);
      const report = await inspect(client);
      assert.equal(report.overall, "warn");
      assert.equal(report.failures.length, 0);
      assert.equal(report.warnings[0]?.code, "rls_enabled_without_policies");
    });

    await t.test("RLS disabled with read-only access warns but does not block", async () => {
      await reset(client);
      const sql = migrationSql(
        `
CREATE TABLE ${SCHEMA}.public_copy (id int);
GRANT SELECT ON ${SCHEMA}.public_copy TO anon;
        `.trim(),
        "004_public_copy.sql",
      );
      await runPsqlScript(sql);
      assert.equal(await ledgerCount(client), 1);
      const report = await inspect(client);
      assert.equal(report.overall, "warn");
      assert.equal(report.failures.length, 0);
      assert.equal(report.warnings[0]?.code, "rls_disabled_read");
    });

    await t.test("ungranted internal table does not hard-fail the push", async () => {
      await reset(client);
      const sql = migrationSql(
        `CREATE TABLE ${SCHEMA}.internal_queue (id int);`,
        "005_internal.sql",
      );
      await runPsqlScript(sql);
      assert.equal(await ledgerCount(client), 1);
      const report = await inspect(client);
      assert.notEqual(report.overall, "fail");
      const finding = report.findings.find((f) => f.table === "internal_queue");
      assert.equal(finding?.code, "rls_disabled_read");
    });
  },
);
