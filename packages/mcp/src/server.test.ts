import { test } from "node:test";
import assert from "node:assert/strict";
import { createToolDefs } from "./server";
import { assertPass1Tools } from "./policy";
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
];

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

test("registers exactly the Pass 1 tool set", () => {
  const defs = createToolDefs(stubClient());
  const names = defs.map((d) => d.name).sort();
  assert.deepEqual(names, [...EXPECTED_TOOLS].sort());
});

test("every tool has an object inputSchema and read/preflight intent", () => {
  const defs = createToolDefs(stubClient());
  for (const def of defs) {
    assert.equal(
      (def.inputSchema as { type?: string }).type,
      "object",
      `${def.name} inputSchema.type`,
    );
    assert.ok(
      def.intentClass === "read" || def.intentClass === "preflight",
      `${def.name} intent must be read/preflight`,
    );
  }
});

test("assertPass1Tools rejects write/destructive intents", () => {
  assert.throws(() => assertPass1Tools([{ name: "x", intentClass: "write" }]));
  assert.throws(() =>
    assertPass1Tools([{ name: "y", intentClass: "destructive" }]),
  );
});
