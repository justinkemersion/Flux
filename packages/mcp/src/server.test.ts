import { test } from "node:test";
import assert from "node:assert/strict";
import { createToolDefs } from "./server";
import {
  assertRegisteredToolsPolicy,
  assertWriteDestructivePolicy,
  auditPersistenceRequired,
  PHASE_3B_PROTECTIVE_TOOLS,
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

test("registers Pass 1 + Pass 2 + Phase 3B protective tool set", () => {
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
        PHASE_3B_PROTECTIVE_TOOLS.has(def.name));
    assert.ok(allowed, `${def.name} intent must be allowed in Phase 3B`);
  }
});

test("assertRegisteredToolsPolicy rejects write/destructive intents", () => {
  assert.throws(() =>
    assertRegisteredToolsPolicy([{ name: "x", intentClass: "write" }]),
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

test("auditPersistenceRequired includes protective_mutation", () => {
  assert.equal(auditPersistenceRequired("protective_mutation"), true);
  assert.equal(auditPersistenceRequired("read"), false);
});

test("write/destructive policy still blocks migration.apply class tools", () => {
  const blocked = assertWriteDestructivePolicy({
    intentClass: "write",
    auditAvailable: true,
    intentRecorded: true,
  });
  assert.equal(blocked.allowed, false);
});
