/**
 * Regression: a nuked pooled tenant must leave no schema, roles, owned objects,
 * or tenant-scoped ledger rows. This is the SQL `flux nuke` / dashboard delete
 * run for v2_shared (see issue #12).
 *
 * Opt-in:
 *   FLUX_RUN_PG_INTEGRATION=1 \
 *   FLUX_TEST_POSTGRES_URL=postgres://postgres:pw@127.0.0.1:5433/postgres \
 *   pnpm --filter @flux/engine-v2 test
 *
 * Point this at a throwaway cluster, never production.
 */
import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { buildDeprovisionSql, buildTenantBootstrapSql, deriveTenantIdentity } from "./index.ts";

const enabled =
  process.env.FLUX_RUN_PG_INTEGRATION === "1" && Boolean(process.env.FLUX_TEST_POSTGRES_URL);

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function connect(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: process.env.FLUX_TEST_POSTGRES_URL });
  await client.connect();
  return client;
}

async function ensureClusterPrereqs(client: pg.Client): Promise<void> {
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN
        CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD 'test-authenticator';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
    END
    $$;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS text
    LANGUAGE sql STABLE AS $flux$
      SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::text;
    $flux$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticator;
  `);
}

async function ensurePushLedgers(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS flux;
    CREATE TABLE IF NOT EXISTS flux.flux_migrations (
      tenant_schema text NOT NULL,
      version text NOT NULL,
      filename text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_schema, version)
    );
    CREATE TABLE IF NOT EXISTS flux.flux_repeatable_scripts (
      tenant_schema text NOT NULL,
      script_id text NOT NULL,
      filename text NOT NULL,
      checksum text NOT NULL,
      run_count integer NOT NULL DEFAULT 0,
      last_applied_at timestamptz,
      PRIMARY KEY (tenant_schema, script_id)
    );
  `);
}

test(
  "nuked pooled tenant leaves no schema, roles, owned objects, or ledger rows",
  { skip: !enabled },
  async () => {
    const client = await connect();
    const identity = deriveTenantIdentity(TENANT_ID);
    try {
      await ensureClusterPrereqs(client);
      await ensurePushLedgers(client);
      await client.query(buildDeprovisionSql(identity));

      await client.query(buildTenantBootstrapSql(identity, TENANT_ID));
      await client.query(`
        CREATE TABLE ${identity.schema}.notes (
          id int PRIMARY KEY,
          body text NOT NULL
        );
        ALTER TABLE ${identity.schema}.notes OWNER TO ${identity.ddlRole};
        INSERT INTO flux.flux_migrations (tenant_schema, version, filename, checksum)
        VALUES ('${identity.schema}', '001', '001_notes.sql', 'deadbeef');
        INSERT INTO flux.flux_repeatable_scripts
          (tenant_schema, script_id, filename, checksum, run_count)
        VALUES ('${identity.schema}', 'seed', 'seed.sql', 'cafebabe', 1);
      `);

      const { rows: beforeSchema } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = $1`,
        [identity.schema],
      );
      assert.equal(beforeSchema[0]?.n, 1, "fixture schema must exist before deprovision");

      const { rows: beforeOwned } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relkind = 'r'`,
        [identity.schema],
      );
      assert.ok((beforeOwned[0]?.n ?? 0) >= 1, "fixture must own at least one table");

      await client.query(buildDeprovisionSql(identity));

      const { rows: schemas } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = $1`,
        [identity.schema],
      );
      assert.equal(schemas[0]?.n, 0, "tenant schema must be gone");

      const { rows: roles } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_roles WHERE rolname = ANY($1::text[])`,
        [[identity.role, identity.ddlRole]],
      );
      assert.equal(roles[0]?.n, 0, "runtime and DDL roles must be gone");

      const { rows: owned } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1`,
        [identity.schema],
      );
      assert.equal(owned[0]?.n, 0, "no objects may remain under the tenant schema");

      const { rows: migrations } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM flux.flux_migrations WHERE tenant_schema = $1`,
        [identity.schema],
      );
      assert.equal(migrations[0]?.n, 0, "versioned ledger rows must be gone");

      const { rows: repeatable } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM flux.flux_repeatable_scripts WHERE tenant_schema = $1`,
        [identity.schema],
      );
      assert.equal(repeatable[0]?.n, 0, "repeatable ledger rows must be gone");
    } finally {
      await client.query(buildDeprovisionSql(identity)).catch(() => undefined);
      await client.end();
    }
  },
);
