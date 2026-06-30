import { test } from "node:test";
import assert from "node:assert/strict";
import { createToolDefs } from "./server";
import { assertNonMutatingTools } from "./policy";
import type { FluxToolClient } from "./tools";

const EXPECTED_TOOLS = [
  // Pass 1 (read / preflight)
  "flux.project.list",
  "flux.project.describe",
  "flux.schema.inspect",
  "flux.schema.counts",
  "flux.migrations.list",
  "flux.doctor",
  "flux.activity",
  "flux.backup.list",
  "flux.destructive.preflight",
  // Pass 2 (plan / credential / readonly query)
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

test("registers exactly the Pass 1 + Pass 2 tool set", () => {
  const defs = createToolDefs(stubClient());
  const names = defs.map((d) => d.name).sort();
  assert.deepEqual(names, [...EXPECTED_TOOLS].sort());
});

test("every tool has an object inputSchema and a non-mutating intent", () => {
  const defs = createToolDefs(stubClient());
  for (const def of defs) {
    assert.equal(
      (def.inputSchema as { type?: string }).type,
      "object",
      `${def.name} inputSchema.type`,
    );
    assert.ok(
      NON_MUTATING.has(def.intentClass),
      `${def.name} intent must be non-mutating`,
    );
  }
});

test("assertNonMutatingTools rejects write/destructive intents", () => {
  assert.throws(() =>
    assertNonMutatingTools([{ name: "x", intentClass: "write" }]),
  );
  assert.throws(() =>
    assertNonMutatingTools([{ name: "y", intentClass: "destructive" }]),
  );
});
