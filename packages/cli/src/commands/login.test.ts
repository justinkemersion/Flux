import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("runFluxLogin --refresh requires a saved token", async () => {
  const prevHome = process.env.HOME;
  const prevToken = process.env.FLUX_API_TOKEN;
  const home = mkdtempSync(join(tmpdir(), "flux-login-test-"));
  process.env.HOME = home;
  delete process.env.FLUX_API_TOKEN;
  mkdirSync(join(home, ".flux"), { recursive: true });

  const { runFluxLogin } = await import(`./login.ts?t=${Date.now()}`);

  await assert.rejects(
    () => runFluxLogin({ refresh: true }),
    /No saved token/i,
  );

  process.env.HOME = prevHome;
  if (prevToken === undefined) delete process.env.FLUX_API_TOKEN;
  else process.env.FLUX_API_TOKEN = prevToken;
});
