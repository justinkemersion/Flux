import test from "node:test";
import assert from "node:assert/strict";
import type { PushPgClient } from "./pooled-push";
import { executePooledMigrationPush } from "./pooled-migrations";

type Row = Record<string, unknown>;

class FakePgClient implements PushPgClient {
  queries: string[] = [];
  private ledger = new Map<string, Map<string, string>>();

  seedVersion(tenantSchema: string, version: string, checksum: string): void {
    let byVersion = this.ledger.get(tenantSchema);
    if (!byVersion) {
      byVersion = new Map();
      this.ledger.set(tenantSchema, byVersion);
    }
    byVersion.set(version, checksum);
  }

  async connect(): Promise<void> {
    return undefined;
  }

  async query(sql: string): Promise<{ rows: Row[] }> {
    this.queries.push(sql);
    const trimmed = sql.trim();
    if (trimmed.startsWith("SELECT checksum")) {
      const schemaMatch = /tenant_schema = '((?:[^']|'')*)'/u.exec(trimmed);
      const versionMatch = /version = '((?:[^']|'')*)'/u.exec(trimmed);
      const tenantSchema = schemaMatch
        ? schemaMatch[1]!.replaceAll("''", "'")
        : "";
      const version = versionMatch
        ? versionMatch[1]!.replaceAll("''", "'")
        : "";
      const checksum = this.ledger.get(tenantSchema)?.get(version);
      return { rows: checksum ? [{ checksum }] : [] };
    }
    if (trimmed.startsWith("SELECT version")) {
      const schemaMatch = /tenant_schema = '((?:[^']|'')*)'/u.exec(trimmed);
      const tenantSchema = schemaMatch
        ? schemaMatch[1]!.replaceAll("''", "'")
        : "";
      const byVersion = this.ledger.get(tenantSchema);
      const rows = [...(byVersion ?? new Map()).entries()].map(
        ([version, checksum]) => ({
          version,
          filename: version,
          checksum,
          appliedAt: "2020-01-01T00:00:00Z",
        }),
      );
      return { rows };
    }
    return { rows: [] };
  }

  async end(): Promise<void> {
    return undefined;
  }
}

test("executePooledMigrationPush skips when checksum matches", async () => {
  const client = new FakePgClient();
  const checksum = "b".repeat(64);
  client.seedVersion("t_test_api", "001_a.sql", checksum);
  const factory = () => client;
  const result = await executePooledMigrationPush({
    schema: "t_test_api",
    userSql: "SELECT 1;",
    migration: {
      version: "001_a.sql",
      filename: "001_a.sql",
      checksum,
    },
    clientFactory: factory,
    timeoutMs: 5000,
  });
  assert.equal(result.skipped, true);
  assert.ok(!client.queries.some((q) => q.includes("INSERT INTO flux")));
});

test("executePooledMigrationPush applies when version missing", async () => {
  const client = new FakePgClient();
  const checksum = "c".repeat(64);
  const factory = () => client;
  const result = await executePooledMigrationPush({
    schema: "t_test_api",
    userSql: "SELECT 2;",
    migration: {
      version: "002_b.sql",
      filename: "002_b.sql",
      checksum,
    },
    clientFactory: factory,
    timeoutMs: 5000,
  });
  assert.equal(result.skipped, false);
  assert.ok(client.queries.some((q) => q.includes("INSERT INTO flux")));
});

test("executePooledMigrationPush rejects checksum conflict", async () => {
  const client = new FakePgClient();
  client.seedVersion("t_test_api", "003_c.sql", "a".repeat(64));
  const factory = () => client;
  await assert.rejects(
    () =>
      executePooledMigrationPush({
        schema: "t_test_api",
        userSql: "SELECT 3;",
        migration: {
          version: "003_c.sql",
          filename: "003_c.sql",
          checksum: "d".repeat(64),
        },
        clientFactory: factory,
        timeoutMs: 5000,
      }),
    /Migration checksum conflict/,
  );
});

test("same migration version is isolated per tenant_schema", async () => {
  const client = new FakePgClient();
  const checksumA = "a".repeat(64);
  const checksumB = "b".repeat(64);
  client.seedVersion("t_tenant_a_api", "001_init.sql", checksumA);
  const factory = () => client;
  const result = await executePooledMigrationPush({
    schema: "t_tenant_b_api",
    userSql: "SELECT 1;",
    migration: {
      version: "001_init.sql",
      filename: "001_init.sql",
      checksum: checksumB,
    },
    clientFactory: factory,
    timeoutMs: 5000,
  });
  assert.equal(result.skipped, false);
  assert.ok(client.queries.some((q) => q.includes("INSERT INTO flux")));
});
