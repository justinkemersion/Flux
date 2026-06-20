import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGuiConfigFields,
  dbTunnelCommand,
} from "./project-db-access-copy.ts";

test("dashboard copy commands include slug and hash", () => {
  assert.equal(
    dbTunnelCommand("yeastcoast", "ffca33f"),
    "flux db tunnel yeastcoast --hash ffca33f",
  );
});

test("dashboard v2 gui config includes search path and no secrets", () => {
  const fields = buildGuiConfigFields({
    slug: "yeastcoast",
    hash: "ffca33f",
    mode: "v2_shared",
    tenantSchema: "t_5ecfa3ab72d1_api",
  });
  assert.match(fields.searchPath ?? "", /t_5ecfa3ab72d1_api/);
  assert.match(fields.passwordBehavior, /Pass 2/);
  assert.doesNotMatch(JSON.stringify(fields), /postgresql:\/\//);
});
