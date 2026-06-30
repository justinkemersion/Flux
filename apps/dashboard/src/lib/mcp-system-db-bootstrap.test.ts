import test from "node:test";
import assert from "node:assert/strict";
import { runSystemDbBootstrap } from "./db/system-db-bootstrap.ts";

test("system DB bootstrap creates MCP audit/intent tables idempotently", async () => {
  const queries: string[] = [];
  const pool = {
    query: async (sql: string) => {
      queries.push(sql);
      return { rows: [] };
    },
  };

  await runSystemDbBootstrap(pool as never);

  const joined = queries.join("\n");
  assert.match(joined, /CREATE TABLE IF NOT EXISTS mcp_audit_events/);
  assert.match(joined, /CREATE TABLE IF NOT EXISTS mcp_intents/);
  assert.match(joined, /mcp_audit_events_user_time_idx/);
  assert.match(joined, /mcp_intents_status_time_idx/);

  const firstCount = queries.length;
  await runSystemDbBootstrap(pool as never);
  assert.equal(queries.length, firstCount * 2);
});
