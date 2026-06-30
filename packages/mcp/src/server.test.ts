import { test } from "node:test";
import assert from "node:assert/strict";
import { createToolDefs } from "./server";
import {
  assertRegisteredToolsPolicy,
  assertWriteDestructivePolicy,
  auditPersistenceRequired,
  PHASE_3B_PROTECTIVE_TOOLS,
  PHASE_4_WRITE_TOOLS,
} from "./policy";
import type { FluxToolClient } from "./tools";
import { FLUX_MCP_TOOL_MANIFEST, manifestToolNames } from "./tool-manifest";

const EXPECTED_TOOLS = manifestToolNames();

const NON_MUTATING = new Set(["read", "preflight", "plan", "credential"]);

function stubClient(): FluxToolClient {
  return new Proxy(
    {},
    {
      get:
        () =>
        async (): Promise<never> => {
          throw new Error("stub client method should not be called at build time");
        },
    },
  ) as unknown as FluxToolClient;
}

test("registers MCP v0.1 manifest tool set", () => {
  const defs = createToolDefs(stubClient());
  const names = defs.map((d) => d.name).sort();
  assert.deepEqual(names, [...EXPECTED_TOOLS].sort());
  assert.equal(defs.length, FLUX_MCP_TOOL_MANIFEST.length);
});

test("every tool has an object inputSchema and allowed intent class", () => {
  const defs = createToolDefs(stubClient());
  for (const def of defs) {
    assert.equal(
      (def.inputSchema as { type?: string }).type,
      "object",
      `${def.name} inputSchema.type`,
    );
    const allowed =
      NON_MUTATING.has(def.intentClass) ||
      (def.intentClass === "protective_mutation" &&
        PHASE_3B_PROTECTIVE_TOOLS.has(def.name)) ||
      (def.intentClass === "write" && PHASE_4_WRITE_TOOLS.has(def.name));
    assert.ok(allowed, `${def.name} intent must be allowed in Phase 4`);
  }
});

test("assertRegisteredToolsPolicy rejects unlisted write/destructive intents", () => {
  assert.throws(() =>
    assertRegisteredToolsPolicy([{ name: "flux.sql.exec", intentClass: "write" }]),
  );
  assert.throws(() =>
    assertRegisteredToolsPolicy([{ name: "y", intentClass: "destructive" }]),
  );
});

test("assertRegisteredToolsPolicy rejects unlisted protective_mutation tools", () => {
  assert.throws(() =>
    assertRegisteredToolsPolicy([
      { name: "flux.backup.create", intentClass: "protective_mutation" },
    ]),
  );
});

test("auditPersistenceRequired includes protective_mutation and write", () => {
  assert.equal(auditPersistenceRequired("protective_mutation"), true);
  assert.equal(auditPersistenceRequired("write"), true);
  assert.equal(auditPersistenceRequired("read"), false);
});

test("write policy allows migration.apply with planId and intent", () => {
  const allowed = assertWriteDestructivePolicy({
    intentClass: "write",
    auditAvailable: true,
    intentRecorded: true,
    planId: "plan-123",
  });
  assert.equal(allowed.allowed, true);
});

test("write policy blocks migration.apply without planId", () => {
  const blocked = assertWriteDestructivePolicy({
    intentClass: "write",
    auditAvailable: true,
    intentRecorded: true,
  });
  assert.equal(blocked.allowed, false);
});
