import test from "node:test";
import assert from "node:assert/strict";
import {
  executePooledPush,
  quoteIdent,
  type PushPgClient,
} from "./pooled-push";

class RecordingClient implements PushPgClient {
  readonly statements: string[] = [];
  ended = false;
  failOn: string | RegExp | null = null;
  failError: Error | null = null;

  async connect(): Promise<void> {
    this.statements.push("__connect__");
  }

  async query(sql: string): Promise<unknown> {
    this.statements.push(sql);
    if (this.failOn) {
      const matches =
        typeof this.failOn === "string"
          ? sql === this.failOn
          : this.failOn.test(sql);
      if (matches) {
        const err = this.failError ?? new Error("simulated query failure");
        this.failError = null;
        this.failOn = null;
        throw err;
      }
    }
    return { rows: [] };
  }

  async end(): Promise<void> {
    this.ended = true;
  }
}

test("executePooledPush issues BEGIN, search_path, user SQL, COMMIT in order", async () => {
  const client = new RecordingClient();
  await executePooledPush({
    schema: "t_aabbccddeeff_api",
    sql: "CREATE TABLE foo (id int);",
    clientFactory: () => client,
  });

  assert.deepEqual(client.statements, [
    "__connect__",
    "BEGIN",
    "SET LOCAL statement_timeout = '30s'",
    'SET LOCAL search_path TO "t_aabbccddeeff_api", public',
    "CREATE TABLE foo (id int);",
    "NOTIFY pgrst, 'reload schema';",
    "COMMIT",
  ]);
  assert.equal(client.ended, true);
});

test("executePooledPush rolls back and rethrows on user SQL error", async () => {
  const client = new RecordingClient();
  client.failOn = /CREATE TABLE/;
  client.failError = Object.assign(new Error("relation already exists"), {
    code: "42P07",
  });

  await assert.rejects(
    () =>
      executePooledPush({
        schema: "t_aabbccddeeff_api",
        sql: "CREATE TABLE foo (id int);",
        clientFactory: () => client,
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, "relation already exists");
      return true;
    },
  );

  assert.ok(
    client.statements.includes("ROLLBACK"),
    "ROLLBACK must be issued after user SQL failure",
  );
  assert.equal(
    client.statements.includes("COMMIT"),
    false,
    "COMMIT must not be issued after a failure",
  );
  assert.equal(client.ended, true, "client.end() must run in finally");
});

test("executePooledPush enforces wall-clock timeout", async () => {
  const hangingClient: PushPgClient = {
    connect: async () => {
      await new Promise<void>(() => {
        // never resolves
      });
    },
    query: async () => ({ rows: [] }),
    end: async () => undefined,
  };

  await assert.rejects(
    () =>
      executePooledPush({
        schema: "t_aabbccddeeff_api",
        sql: "SELECT 1",
        clientFactory: () => hangingClient,
        timeoutMs: 25,
      }),
    /exceeded 0\.025s timeout/,
  );
});

test("quoteIdent wraps and doubles embedded quotes", () => {
  assert.equal(quoteIdent("plain"), '"plain"');
  assert.equal(quoteIdent('weird"name'), '"weird""name"');
});
