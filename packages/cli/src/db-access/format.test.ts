import test from "node:test";
import assert from "node:assert/strict";
import { resolveProjectDatabaseAccess } from "@flux/core";
import {
  buildV1PostgresCredentialSectionLines,
  parsePostgresConnectionFields,
} from "../postgres-connection-fields";
import {
  buildGuiConfigFields,
  dbDumpCommand,
  dbGuiConfigCommand,
  dbPasswordCommand,
  dbTunnelCommand,
  formatGuiConfigText,
  formatGuiConfigTextWithCredential,
  formatV2DbPasswordRefusal,
} from "./format";
import { buildSshTunnelArgs } from "./ssh-tunnel";

const V1_PROJECT_ID = "5ecfa3ab-72d1-4b3a-9c8e-111111111111";

test("buildSshTunnelArgs uses spawn args without shell concatenation", () => {
  const args = buildSshTunnelArgs({
    localHost: "127.0.0.1",
    localPort: 15432,
    remoteHost: "172.18.0.4",
    remotePort: 5432,
    sshHost: "178.104.205.138",
    sshUser: "root",
    sshPort: 22,
    identityFile: "/home/me/.ssh/id_ed25519",
    keepalive: true,
  });

  assert.deepEqual(args, [
    "-N",
    "-L",
    "127.0.0.1:15432:172.18.0.4:5432",
    "-p",
    "22",
    "-o",
    "BatchMode=yes",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
    "-i",
    "/home/me/.ssh/id_ed25519",
    "-o",
    "ExitOnForwardFailure=yes",
    "root@178.104.205.138",
  ]);
  assert.doesNotMatch(args.join(" "), /;/);
});

test("command rendering includes project slug and hash", () => {
  assert.equal(
    dbTunnelCommand("yeastcoast", "ffca33f"),
    "flux db tunnel yeastcoast --hash ffca33f",
  );
  assert.equal(
    dbGuiConfigCommand("yeastcoast", "ffca33f"),
    "flux db gui-config yeastcoast --hash ffca33f",
  );
  assert.equal(
    dbDumpCommand("yeastcoast", "ffca33f"),
    "flux db dump yeastcoast --hash ffca33f --output yeastcoast.dump",
  );
  assert.equal(
    dbPasswordCommand("yeastcoast", "ffca33f"),
    "flux db password yeastcoast --hash ffca33f",
  );
});

test("v1 credentials section includes a separate Password line", () => {
  const fields = parsePostgresConnectionFields(
    "postgresql://postgres:secret-pass@flux-ffca33f-yeastcoast-db:5432/postgres",
  );
  const section = buildV1PostgresCredentialSectionLines(fields).join("\n");
  assert.match(section, /^Password:  secret-pass$/m);
  assert.match(section, /^Host:      flux-ffca33f-yeastcoast-db$/m);
});

test("gui config for v1 points password to flux db password command", () => {
  const plan = resolveProjectDatabaseAccess({
    id: V1_PROJECT_ID,
    slug: "yeastcoast",
    hash: "ffca33f",
    mode: "v1_dedicated",
  });
  const fields = buildGuiConfigFields(plan);
  assert.equal(fields.user, "postgres");
  assert.match(fields.passwordBehavior, /flux db password yeastcoast --hash ffca33f/);
  const rendered = formatGuiConfigText(plan).join("\n");
  assert.doesNotMatch(rendered, /postgres:\/\//);
  assert.doesNotMatch(rendered, /secret-pass/);
  assert.match(rendered, /Password: run `flux db password yeastcoast --hash ffca33f`/);
  assert.match(rendered, /only works while `flux db tunnel`/);
});

test("flux db password refusal explains v2_shared temporary credentials", () => {
  const message = formatV2DbPasswordRefusal("flux-app-foundry", "5774112");
  assert.match(message, /v2_shared projects use temporary scoped credentials/);
  assert.match(message, /flux db tunnel flux-app-foundry --hash 5774112/);
});

test("gui config for v2 does not expose admin credentials", () => {
  const plan = resolveProjectDatabaseAccess({
    id: V1_PROJECT_ID,
    slug: "yeastcoast",
    hash: "ffca33f",
    mode: "v2_shared",
  });
  const fields = buildGuiConfigFields(plan);
  assert.match(fields.passwordBehavior, /flux db tunnel/);
  assert.doesNotMatch(fields.passwordBehavior, /postgresql:\/\//);
  assert.match(fields.searchPath ?? "", /t_5ecfa3ab72d1_api/);
});

test("gui config for v2 with temp credential shows one-time password only when created", () => {
  const plan = resolveProjectDatabaseAccess({
    id: V1_PROJECT_ID,
    slug: "flux-app-foundry",
    hash: "5774112",
    mode: "v2_shared",
  });
  const rendered = formatGuiConfigTextWithCredential(plan, {
    username: "flux_temp_abcd1234_ro",
    password: "one-time-temp-pass",
    access: "readonly",
    expiresAt: "2026-06-20T12:00:00.000Z",
    tenantSchema: "t_c50731f62edd_api",
    searchPath: ["t_c50731f62edd_api", "public"],
  }).join("\n");
  assert.match(rendered, /Password: one-time-temp-pass/);
  assert.doesNotMatch(rendered, /postgresql:\/\//);
  assert.doesNotMatch(rendered, /SHARED_POSTGRES/);
});
