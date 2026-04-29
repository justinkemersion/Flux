import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function loadConfigModuleWithHome(homeDir: string) {
  const prevHome = process.env.HOME;
  process.env.HOME = homeDir;
  const mod = await import(`./config.ts?home=${encodeURIComponent(homeDir)}-${Date.now()}`);
  process.env.HOME = prevHome;
  return mod as typeof import("./config");
}

test("loadConfig remains compatible with legacy token-only file", async () => {
  const home = mkdtempSync(join(tmpdir(), "flux-cli-test-"));
  const fluxDir = join(home, ".flux");
  mkdirSync(fluxDir, { recursive: true });
  writeFileSync(
    join(fluxDir, "config.json"),
    `${JSON.stringify({ token: "flx_live_legacy" }, null, 2)}\n`,
  );
  const mod = await loadConfigModuleWithHome(home);
  const cfg = mod.loadConfig();
  assert.equal(cfg?.token, "flx_live_legacy");
  assert.equal(cfg?.profile, undefined);
});

test("loadConfig reads profile fields when present", async () => {
  const home = mkdtempSync(join(tmpdir(), "flux-cli-test-"));
  const fluxDir = join(home, ".flux");
  mkdirSync(fluxDir, { recursive: true });
  writeFileSync(
    join(fluxDir, "config.json"),
    `${JSON.stringify(
      {
        token: "flx_live_new",
        profile: { plan: "pro", defaultMode: "v1_dedicated" },
      },
      null,
      2,
    )}\n`,
  );
  const mod = await loadConfigModuleWithHome(home);
  const cfg = mod.loadConfig();
  assert.equal(cfg?.token, "flx_live_new");
  assert.deepEqual(cfg?.profile, { plan: "pro", defaultMode: "v1_dedicated" });
});
