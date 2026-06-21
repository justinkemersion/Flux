import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGuiConfigFields,
  dbTunnelCommand,
  listDatabaseGuiConfigFields,
} from "./project-db-access-copy.ts";

test("dashboard copy commands include slug and hash", () => {
  assert.equal(
    dbTunnelCommand("yeastcoast", "ffca33f"),
    "flux db tunnel yeastcoast --hash ffca33f",
  );
});

test("dashboard v2 gui config includes databaseName tenant schema and SSH tunnel off", () => {
  const hints = buildGuiConfigFields({
    slug: "noisydesign",
    hash: "5ff9c19",
    mode: "v2_shared",
    tenantSchema: "t_f361c4681136_api",
  });
  assert.equal(hints.databaseName, "postgres");
  assert.equal(hints.tenantSchema, "t_f361c4681136_api");
  const fields = listDatabaseGuiConfigFields(hints);
  const labels = fields.map((f) => f.label);
  assert.ok(labels.includes("Database"));
  assert.ok(labels.includes("Tenant schema"));
  assert.ok(labels.includes("SSH tunnel (GUI)"));
  const databaseField = fields.find((f) => f.label === "Database");
  assert.equal(databaseField?.value, "postgres");
  assert.match(JSON.stringify(fields), /flux db tunnel/);
  assert.doesNotMatch(JSON.stringify(fields), /postgresql:\/\//);
});
