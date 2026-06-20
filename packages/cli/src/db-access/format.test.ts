import test from "node:test";
import assert from "node:assert/strict";
import { resolveProjectDatabaseAccess } from "@flux/core";
import {
  buildGuiConfigFields,
  dbDumpCommand,
  dbGuiConfigCommand,
  dbTunnelCommand,
  formatGuiConfigText,
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
});

test("gui config for v1 points password to credentials command", () => {
  const plan = resolveProjectDatabaseAccess({
    id: V1_PROJECT_ID,
    slug: "yeastcoast",
    hash: "ffca33f",
    mode: "v1_dedicated",
  });
  const fields = buildGuiConfigFields(plan);
  assert.equal(fields.user, "postgres");
  assert.match(fields.passwordBehavior, /flux project credentials/);
  const rendered = formatGuiConfigText(plan).join("\n");
  assert.doesNotMatch(rendered, /postgres:\/\//);
  assert.match(rendered, /only works while `flux db tunnel`/);
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
