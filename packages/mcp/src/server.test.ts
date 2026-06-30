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

const EXPECTED_TOOLS = [
  "flux.project.list",
  "flux.project.describe",
  "flux.schema.inspect",
  "flux.schema.counts",
  "flux.migrations.list",
  "flux.doctor",
  "flux.activity",
  "flux.backup.list",
  "flux.destructive.preflight",
  "flux.backup.ensureVerified",
  "flux.migration.plan",
  "flux.migration.apply",
  "flux.credentials.temporary",
  "flux.query.readonly",
];

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

test("registers Pass 1 + Pass 2 + Phase 3B + Phase 4 write tool set", () => {
  const defs = createToolDefs(stubClient());
  const names = defs.map((d) => d.name).sort();
  assert.deepEqual(names, [...EXPECTED_TOOLS].sort());
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
