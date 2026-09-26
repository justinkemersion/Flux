/**
 * Blinded SECURITY DEFINER audit — real Postgres.
 *
 * The detector is a catalog query. Unit tests can only check the SQL text and the
 * doctor/push wrappers. Whether a definer is flagged, an owner-scoped policy clears
 * it, and an invoker is ignored are properties of Postgres (pg_proc, pg_policy,
 * FORCE RLS), so they are asserted here.
 *
 * Opt-in (throwaway cluster only):
 *   FLUX_RUN_PG_INTEGRATION=1 \
 *   FLUX_TEST_POSTGRES_URL=postgres://postgres:pw@127.0.0.1:5432/postgres \
 *   pnpm --filter dashboard exec tsx --tsconfig tsconfig.json --test \
 *     src/lib/blinded-security-definer.integration.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { buildDeprovisionSql, buildTenantBootstrapSql, deriveTenantIdentity } from "@flux/engine-v2";
import {
  buildInspectBlindedSecurityDefinersSql,
  formatBlindedSecurityDefinerWarnings,
  parseBlindedSecurityDefinerFindings,
  type BlindedSecurityDefinerFinding,
} from "@flux/core/tenant-rls-invariants";
import { quoteIdent } from "@/src/lib/pooled-push";
import {
  beginPooledPushTransaction,
  enforcePooledPushRlsInvariants,
  finishPooledPushTransaction,
  resetPooledPushRole,
  setPooledPushTenantContext,
} from "@/src/lib/pooled-push-session";

const enabled =
  process.env.FLUX_RUN_PG_INTEGRATION === "1" && Boolean(process.env.FLUX_TEST_POSTGRES_URL);

const TENANT = "33333333-3333-4333-8333-333333333333";
const AUTHENTICATOR_PASSWORD = "test-authenticator";

async function connect(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: process.env.FLUX_TEST_POSTGRES_URL });
  await client.connect();
  return client;
}

/** Same cluster prerequisites as the Pass 6b privilege integration test. */
async function ensureClusterPrereqs(client: pg.Client): Promise<void> {
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN
        CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD '${AUTHENTICATOR_PASSWORD}';
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

async function push(
  client: pg.Client,
  identity: { schema: string; role: string; ddlRole: string },
  sql: string,
): Promise<string[]> {
  await beginPooledPushTransaction(client);
  try {
    await setPooledPushTenantContext(client, {
      schema: identity.schema,
      ddlRole: identity.ddlRole,
    });
    await client.query(sql);
    await resetPooledPushRole(client);
    const warnings = await enforcePooledPushRlsInvariants(client, {
      schema: identity.schema,
      runtimeRole: identity.role,
    });
    await finishPooledPushTransaction(client);
    return warnings;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function inspect(client: pg.Client, schema: string): Promise<BlindedSecurityDefinerFinding[]> {
  const { rows } = await client.query(buildInspectBlindedSecurityDefinersSql(schema));
  return parseBlindedSecurityDefinerFindings(rows as unknown[]);
}

function names(findings: readonly BlindedSecurityDefinerFinding[]): Set<string> {
  return new Set(findings.map((finding) => finding.functionName));
}

async function countAsOwner(
  client: pg.Client,
  identity: { schema: string; ddlRole: string },
): Promise<number> {
  await client.query("BEGIN");
  try {
    await client.query(`SET LOCAL ROLE ${quoteIdent(identity.ddlRole)}`);
    await client.query(`SET LOCAL search_path TO ${quoteIdent(identity.schema)}`);
    const { rows } = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM members");
    return rows[0]?.n ?? -1;
  } finally {
    await client.query("ROLLBACK");
  }
}

test(
  "blinded SECURITY DEFINER audit (requires FLUX_RUN_PG_INTEGRATION=1)",
  { skip: !enabled },
  async () => {
    const client = await connect();
    await ensureClusterPrereqs(client);
    await client.query(buildDeprovisionSql(deriveTenantIdentity(TENANT))).catch(() => {});
    const identity = deriveTenantIdentity(TENANT);
    await client.query(buildTenantBootstrapSql(identity, TENANT));

    try {
      const warnings = await push(
        client,
        identity,
        `
        CREATE TABLE members (
          id int PRIMARY KEY,
          user_id text NOT NULL
        );
        ALTER TABLE members ENABLE ROW LEVEL SECURITY;
        CREATE POLICY members_runtime ON members
          FOR ALL
          TO ${identity.role}
          USING (true)
          WITH CHECK (true);
        CREATE POLICY members_definer_insert ON members
          FOR INSERT
          TO ${identity.ddlRole}
          WITH CHECK (true);

        CREATE TABLE audit_open (
          id int PRIMARY KEY
        );
        ALTER TABLE audit_open ENABLE ROW LEVEL SECURITY;
        COMMENT ON TABLE audit_open IS 'flux:no-force-rls — owner-readable on purpose';
        CREATE POLICY audit_open_runtime ON audit_open
          FOR ALL
          TO ${identity.role}
          USING (true)
          WITH CHECK (true);

        CREATE FUNCTION read_members_definer() RETURNS int
        LANGUAGE sql
        SECURITY DEFINER
        AS $$ SELECT count(*)::int FROM members $$;

        CREATE FUNCTION read_members_qualified() RETURNS int
        LANGUAGE sql
        SECURITY DEFINER
        AS $$ SELECT count(*)::int FROM ${identity.schema}.members $$;

        CREATE FUNCTION read_members_after_comment() RETURNS int
        LANGUAGE sql
        SECURITY DEFINER
        AS $$
          -- note before the read
          SELECT count(*)::int FROM members
        $$;

        CREATE FUNCTION read_members_invoker() RETURNS int
        LANGUAGE sql
        AS $$ SELECT count(*)::int FROM members $$;

        CREATE FUNCTION read_members_plpgsql() RETURNS int
        LANGUAGE plpgsql
        SECURITY DEFINER
        AS $$
        DECLARE n int;
        BEGIN
          SELECT count(*)::int INTO n FROM members;
          RETURN n;
        END
        $$;

        CREATE FUNCTION read_members_dynamic() RETURNS int
        LANGUAGE plpgsql
        SECURITY DEFINER
        AS $$
        DECLARE n int;
        BEGIN
          EXECUTE format('SELECT count(*)::int FROM %I', 'members') INTO n;
          RETURN n;
        END
        $$;

        CREATE FUNCTION comment_only() RETURNS int
        LANGUAGE sql
        SECURITY DEFINER
        AS $$
          -- from members
          SELECT 1
        $$;

        CREATE FUNCTION read_audit_open() RETURNS int
        LANGUAGE sql
        SECURITY DEFINER
        AS $$ SELECT count(*)::int FROM audit_open $$;

        CREATE TABLE tokens (
          id int PRIMARY KEY
        );
        ALTER TABLE tokens ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tokens_public ON tokens
          FOR SELECT
          TO PUBLIC
          USING (true);

        CREATE FUNCTION read_tokens_definer() RETURNS int
        LANGUAGE sql
        SECURITY DEFINER
        AS $$ SELECT count(*)::int FROM tokens $$;
        `,
      );

      const flagged = await inspect(client, identity.schema);
      const flaggedNames = names(flagged);
      assert.ok(
        flaggedNames.has("read_members_definer"),
        "SECURITY DEFINER that reads a FORCE RLS table with no owner/PUBLIC SELECT policy is flagged",
      );
      assert.ok(
        flaggedNames.has("read_members_qualified"),
        "FROM schema.table with no space around the dot is flagged",
      );
      assert.ok(
        flaggedNames.has("read_members_after_comment"),
        "a -- comment before FROM does not hide the read",
      );
      assert.ok(
        flaggedNames.has("read_members_plpgsql"),
        "plpgsql definer with a static FROM is flagged",
      );
      assert.equal(
        flaggedNames.has("read_members_invoker"),
        false,
        "a non-definer function is not flagged",
      );
      assert.equal(
        flaggedNames.has("read_members_dynamic"),
        false,
        "dynamic SQL that builds the table name is outside the lexical scan",
      );
      assert.equal(
        flaggedNames.has("comment_only"),
        false,
        "a comment that mentions FROM <table> is not flagged",
      );
      assert.equal(
        flaggedNames.has("read_audit_open"),
        false,
        "a definer reading a flux:no-force-rls table is not flagged",
      );
      assert.equal(
        flaggedNames.has("read_tokens_definer"),
        false,
        "a permissive SELECT policy TO PUBLIC is not flagged",
      );
      assert.ok(
        flagged.every((hit) => hit.tableName === "members"),
        "only the FORCE RLS table is reported",
      );
      assert.ok(flagged.every((hit) => hit.ownerRole === identity.ddlRole));
      assert.match(warnings.join("\n"), /read_members_definer/);
      assert.match(warnings.join("\n"), /BYPASSRLS/);
      assert.equal(
        warnings.some((warning) => warning.includes("COMMIT") || warning.includes("prosrc")),
        false,
      );

      await client.query(
        `INSERT INTO ${quoteIdent(identity.schema)}.members (id, user_id) VALUES (1, 'user-1')`,
      );
      assert.equal(
        await countAsOwner(client, identity),
        0,
        "the DDL owner sees zero rows through FORCE RLS before an owner policy exists",
      );

      await push(
        client,
        identity,
        `
        CREATE POLICY members_definer_select ON members
          FOR SELECT
          TO ${identity.ddlRole}
          USING (true);
        `,
      );

      const cleared = names(await inspect(client, identity.schema));
      assert.equal(
        cleared.has("read_members_definer"),
        false,
        "a SELECT policy scoped to the definer owner is not flagged",
      );
      assert.equal(cleared.has("read_members_plpgsql"), false);
      assert.equal(cleared.has("read_members_invoker"), false);
      assert.equal(
        await countAsOwner(client, identity),
        1,
        "the owner-scoped SELECT policy lets the definer owner see the row",
      );

      const formatted = formatBlindedSecurityDefinerWarnings(flagged);
      assert.match(formatted[0] ?? "", /Do not grant BYPASSRLS/);
      assert.match(formatted.at(-1) ?? "", /Dynamic SQL/);
    } finally {
      await client.query("RESET ROLE").catch(() => {});
      await client.query(buildDeprovisionSql(identity)).catch(() => {});
      await client.end();
    }
  },
);
