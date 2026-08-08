/**
 * Pass 6b — real-Postgres verification of the tenant privilege model.
 *
 * Unit tests can only prove which SQL strings we emit. The properties that actually
 * matter here (who owns a pushed table, whether RLS applies to the runtime role,
 * whether that role can escalate) are enforced by Postgres, so they are asserted
 * against a live cluster.
 *
 * Opt-in:
 *   FLUX_RUN_PG_INTEGRATION=1 \
 *   FLUX_TEST_POSTGRES_URL=postgres://postgres:pw@127.0.0.1:5433/postgres \
 *   pnpm --filter @flux/dashboard test
 *
 * The target cluster is mutated (roles + schemas created and dropped). Point it at a
 * throwaway container, never at production.
 */
import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { buildDeprovisionSql, buildTenantBootstrapSql, deriveTenantIdentity } from "@flux/engine-v2";
import {
  beginPooledPushTransaction,
  enforcePooledPushRlsInvariants,
  finishPooledPushTransaction,
  resetPooledPushRole,
  setPooledPushTenantContext,
} from "@/src/lib/pooled-push-session";

const enabled =
  process.env.FLUX_RUN_PG_INTEGRATION === "1" && Boolean(process.env.FLUX_TEST_POSTGRES_URL);

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

const AUTHENTICATOR_PASSWORD = "test-authenticator";

async function connect(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: process.env.FLUX_TEST_POSTGRES_URL });
  await client.connect();
  return client;
}

/**
 * Connects the way PostgREST does — as the `authenticator` login role, which then
 * `SET ROLE`s to the tenant role. Asserting privilege limits from a superuser session
 * would prove nothing: a superuser can SET ROLE to anything and bypasses RLS.
 */
async function connectAsAuthenticator(): Promise<pg.Client> {
  const url = new URL(process.env.FLUX_TEST_POSTGRES_URL as string);
  url.username = "authenticator";
  url.password = AUTHENTICATOR_PASSWORD;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  return client;
}

/** Cluster prerequisites normally created by bin/deploy-v2-shared.sh. */
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
  `);
}

async function provision(client: pg.Client, tenantId: string) {
  const identity = deriveTenantIdentity(tenantId);
  await client.query(buildTenantBootstrapSql(identity, tenantId));
  await client.query(`GRANT ${identity.role} TO authenticator`);
  return identity;
}

async function deprovision(client: pg.Client, tenantId: string): Promise<void> {
  await client.query(buildDeprovisionSql(deriveTenantIdentity(tenantId)));
}

/** Mirrors executePooledPush's transaction shape without its pg.Client factory. */
async function push(
  client: pg.Client,
  identity: { schema: string; role: string; ddlRole: string },
  sql: string,
): Promise<void> {
  await beginPooledPushTransaction(client);
  try {
    await setPooledPushTenantContext(client, {
      schema: identity.schema,
      ddlRole: identity.ddlRole,
    });
    await client.query(sql);
    await resetPooledPushRole(client);
    await enforcePooledPushRlsInvariants(client, {
      schema: identity.schema,
      runtimeRole: identity.role,
    });
    await finishPooledPushTransaction(client);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function asRuntimeRole<T>(
  client: pg.Client,
  identity: { schema: string; role: string },
  fn: () => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  await client.query(`SET LOCAL ROLE ${identity.role}`);
  await client.query(`SET LOCAL search_path TO ${identity.schema}`);
  try {
    return await fn();
  } finally {
    await client.query("ROLLBACK");
  }
}

async function expectError(fn: () => Promise<unknown>, matcher: RegExp): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    assert.match(message, matcher);
    return;
  }
  assert.fail(`expected a rejection matching ${String(matcher)}`);
}

/**
 * Wraps a statement expected to fail in a savepoint: a failed statement aborts the
 * surrounding transaction, and every later assertion would otherwise collapse into
 * "current transaction is aborted".
 */
async function expectErrorIsolated(
  client: pg.Client,
  sql: string,
  matcher: RegExp,
): Promise<void> {
  await client.query("SAVEPOINT flux_probe");
  await expectError(() => client.query(sql), matcher);
  await client.query("ROLLBACK TO SAVEPOINT flux_probe");
}

test(
  "Pass 6b tenant privilege model (requires FLUX_RUN_PG_INTEGRATION=1)",
  { skip: !enabled },
  async (t) => {
    const client = await connect();
    await ensureClusterPrereqs(client);
    await deprovision(client, TENANT_A).catch(() => {});
    await deprovision(client, TENANT_B).catch(() => {});

    const a = await provision(client, TENANT_A);
    const b = await provision(client, TENANT_B);
    const runtime = await connectAsAuthenticator();

    t.after(async () => {
      await runtime.end().catch(() => {});
      await deprovision(client, TENANT_A).catch(() => {});
      await deprovision(client, TENANT_B).catch(() => {});
      await client.end();
    });

    await t.test("a migration can create a table", async () => {
      await push(
        client,
        a,
        `CREATE TABLE notes (
           id bigserial PRIMARY KEY,
           user_id text NOT NULL,
           body text NOT NULL
         );
         ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
         CREATE POLICY notes_owner ON notes
           USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub')
           WITH CHECK (user_id = current_setting('request.jwt.claims', true)::json->>'sub');
         GRANT SELECT, INSERT ON notes TO ${a.role};
         GRANT USAGE, SELECT ON SEQUENCE notes_id_seq TO ${a.role};`,
      );
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname=$1 AND c.relname='notes'`,
        [a.schema],
      );
      assert.equal(rows[0].n, 1);
    });

    await t.test("the pushed table is owned by the DDL role, not the runtime role", async () => {
      const { rows } = await client.query(
        `SELECT pg_get_userbyid(c.relowner) AS owner
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname=$1 AND c.relname='notes'`,
        [a.schema],
      );
      assert.equal(rows[0].owner, a.ddlRole);
      assert.notEqual(rows[0].owner, a.role);
    });

    await t.test("RLS is forced, so ownership drift cannot silently disable it", async () => {
      const { rows } = await client.query(
        `SELECT c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname=$1 AND c.relname='notes'`,
        [a.schema],
      );
      assert.equal(rows[0].relrowsecurity, true);
      assert.equal(rows[0].relforcerowsecurity, true);
    });

    await t.test("the runtime role reaches only what it was granted", async () => {
      await push(client, a, `CREATE TABLE private_notes (id int PRIMARY KEY);`);
      await asRuntimeRole(runtime, a, async () => {
        // SELECT is expected on both: bootstrap's FOR ROLE default privileges grant it
        // on everything the DDL role creates. Writes require an explicit grant.
        await runtime.query("SELECT 1 FROM notes LIMIT 1");
        await runtime.query("SELECT 1 FROM private_notes LIMIT 1");
        await runtime.query("SAVEPOINT ok_write");
        await runtime.query(`SELECT set_config('request.jwt.claims', '{"sub":"user-1"}', true)`);
        await runtime.query("INSERT INTO notes (user_id, body) VALUES ('user-1','via runtime')");
        await runtime.query("ROLLBACK TO SAVEPOINT ok_write");
        await expectErrorIsolated(
          runtime,
          "INSERT INTO private_notes (id) VALUES (1)",
          /permission denied for table/i,
        );
      });
    });

    await t.test("the runtime role cannot create, alter, or drop", async () => {
      await asRuntimeRole(runtime, a, async () => {
        await expectErrorIsolated(
          runtime,
          "CREATE TABLE escalation (id int)",
          /permission denied for schema/i,
        );
        await expectErrorIsolated(
          runtime,
          "ALTER TABLE notes ADD COLUMN injected text",
          /must be owner of table/i,
        );
        await expectErrorIsolated(runtime, "DROP TABLE notes", /must be owner of table/i);
      });
    });

    await t.test("the runtime role cannot assume the DDL role", async () => {
      await asRuntimeRole(runtime, a, async () => {
        await expectErrorIsolated(
          runtime,
          `SET ROLE ${a.ddlRole}`,
          /permission denied to set role/i,
        );
      });
    });

    await t.test("RLS still filters rows under the runtime role", async () => {
      await client.query(
        `INSERT INTO ${a.schema}.notes (user_id, body) VALUES ('user-1','mine'),('user-2','theirs')`,
      );
      await asRuntimeRole(runtime, a, async () => {
        await runtime.query(
          `SELECT set_config('request.jwt.claims', '{"sub":"user-1"}', true)`,
        );
        const { rows } = await runtime.query("SELECT user_id, body FROM notes ORDER BY user_id");
        assert.deepEqual(rows, [{ user_id: "user-1", body: "mine" }]);
      });
    });

    await t.test("a tenant cannot push DDL into another tenant's schema", async () => {
      await expectError(
        () => push(client, a, `CREATE TABLE ${b.schema}.stolen (id int)`),
        /permission denied for schema/i,
      );
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname=$1 AND c.relname='stolen'`,
        [b.schema],
      );
      assert.equal(rows[0].n, 0);
    });

    await t.test("a failed push leaves no artifacts behind", async () => {
      await expectError(
        () =>
          push(
            client,
            a,
            `CREATE TABLE partial_a (id int);
             CREATE TABLE partial_b (id int);
             SELECT 1 / 0;`,
          ),
        /division by zero/i,
      );
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname=$1 AND c.relname LIKE 'partial_%'`,
        [a.schema],
      );
      assert.equal(rows[0].n, 0);
    });

    await t.test("the push aborts if the runtime role owns a tenant object", async () => {
      await client.query(`ALTER TABLE ${a.schema}.notes OWNER TO ${a.role}`);
      try {
        await expectError(
          () => push(client, a, `CREATE TABLE drift_check (id int);`),
          /owned by the runtime role/i,
        );
        const { rows } = await client.query(
          `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname=$1 AND c.relname='drift_check'`,
          [a.schema],
        );
        assert.equal(rows[0].n, 0);
      } finally {
        await client.query(`ALTER TABLE ${a.schema}.notes OWNER TO ${a.ddlRole}`);
      }
    });
  },
);
