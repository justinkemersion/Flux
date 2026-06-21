import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDashboardDatabaseGuiHints,
  buildDatabaseGuiConnectionHints,
  formatAccessPlanGuiSummary,
  formatDatabaseGuiConfigLines,
  listDatabaseGuiConfigFields,
  toDatabaseGuiStructuredFields,
  V2_GUI_DATABASE_WARNING,
} from "./database-access-gui.ts";
import { resolveProjectDatabaseAccess } from "./database-access.ts";

const V1_PROJECT_ID = "5ecfa3ab-72d1-4b3a-9c8e-111111111111";

test("buildDatabaseGuiConnectionHints: v2 uses plan.databaseName", () => {
  const plan = resolveProjectDatabaseAccess({
    id: V1_PROJECT_ID,
    slug: "flux-app-foundry",
    hash: "5774112",
    mode: "v2_shared",
  });
  const hints = buildDatabaseGuiConnectionHints(plan);
  assert.equal(hints.databaseName, "postgres");
  assert.equal(hints.tenantSchema, "t_5ecfa3ab72d1_api");
  assert.equal(hints.searchPath, "t_5ecfa3ab72d1_api, public");
  assert.equal(hints.guiSshTunnel, "off");
});

test("buildDatabaseGuiConnectionHints: v2 temp credential adds database warning", () => {
  const plan = resolveProjectDatabaseAccess({
    id: V1_PROJECT_ID,
    slug: "noisydesign",
    hash: "5ff9c19",
    mode: "v2_shared",
  });
  const hints = buildDatabaseGuiConnectionHints(plan, {
    username: "flux_temp_ro_5ff9c19_8d1ce67a",
    password: "one-time-temp-pass",
    tenantSchema: "t_f361c4681136_api",
    searchPath: ["t_f361c4681136_api", "public"],
  });
  assert.equal(hints.databaseName, "postgres");
  assert.notEqual(hints.databaseName, hints.user);
  assert.equal(hints.v2DatabaseWarning, V2_GUI_DATABASE_WARNING);
});

test("formatDatabaseGuiConfigLines: v2 field order and labels", () => {
  const plan = resolveProjectDatabaseAccess({
    id: V1_PROJECT_ID,
    slug: "noisydesign",
    hash: "5ff9c19",
    mode: "v2_shared",
  });
  const lines = formatDatabaseGuiConfigLines(
    buildDatabaseGuiConnectionHints(plan, {
      username: "flux_temp_ro_5ff9c19_8d1ce67a",
      password: "one-time-temp-pass",
    }),
  );
  const joined = lines.join("\n");
  assert.match(joined, /^Database: postgres$/m);
  assert.match(joined, /^Tenant schema: t_5ecfa3ab72d1_api$/m);
  assert.match(joined, /^Search path: t_5ecfa3ab72d1_api, public$/m);
  assert.match(joined, /^SSH tunnel \(GUI\): off —/m);
  assert.match(joined, /Do not use the temp username as the database name/);
  const dbIdx = lines.findIndex((l) => l.startsWith("Database:"));
  const userIdx = lines.findIndex((l) => l.startsWith("User:"));
  assert.ok(dbIdx > userIdx);
});

test("toDatabaseGuiStructuredFields uses databaseName key", () => {
  const plan = resolveProjectDatabaseAccess({
    id: V1_PROJECT_ID,
    slug: "yeastcoast",
    hash: "ffca33f",
    mode: "v2_shared",
  });
  const structured = toDatabaseGuiStructuredFields(
    buildDatabaseGuiConnectionHints(plan),
  );
  assert.equal(structured.databaseName, "postgres");
  assert.equal(structured.guiSshTunnel, "off");
  assert.deepEqual(structured.searchPath, ["t_5ecfa3ab72d1_api", "public"]);
  assert.equal("database" in structured, false);
});

test("formatAccessPlanGuiSummary: v2 pooled GUI hints", () => {
  const plan = resolveProjectDatabaseAccess({
    id: V1_PROJECT_ID,
    slug: "yeastcoast",
    hash: "ffca33f",
    mode: "v2_shared",
  });
  const summary = formatAccessPlanGuiSummary(plan);
  assert.match(summary.join("\n"), /Database: postgres/);
  assert.match(summary.join("\n"), /Tenant schema: t_5ecfa3ab72d1_api/);
});

test("buildDashboardDatabaseGuiHints: static v2 preview", () => {
  const hints = buildDashboardDatabaseGuiHints({
    slug: "noisydesign",
    hash: "5ff9c19",
    mode: "v2_shared",
    tenantSchema: "t_f361c4681136_api",
  });
  assert.equal(hints.databaseName, "postgres");
  assert.equal(hints.tenantSchema, "t_f361c4681136_api");
  const labels = listDatabaseGuiConfigFields(hints).map((f) => f.label);
  assert.deepEqual(labels.slice(0, 7), [
    "Connection Name",
    "Type",
    "Host",
    "Port",
    "User",
    "Password",
    "Database",
  ]);
});

test("buildDatabaseGuiConnectionHints: v1 unchanged password hint", () => {
  const plan = resolveProjectDatabaseAccess({
    id: V1_PROJECT_ID,
    slug: "yeastcoast",
    hash: "ffca33f",
    mode: "v1_dedicated",
  });
  const hints = buildDatabaseGuiConnectionHints(plan);
  assert.equal(hints.user, "postgres");
  assert.match(hints.passwordHint, /flux db password yeastcoast --hash ffca33f/);
  assert.equal(hints.tenantSchema, undefined);
  assert.equal(hints.v2DatabaseWarning, undefined);
});
