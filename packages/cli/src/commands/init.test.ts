import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FLUX_INIT_PLACEHOLDER_HASH } from "../flux-config";

test("cmdInit fails without flux.json", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flux-init-"));
  const { cmdInit } = await import(`./init.ts?test=${Date.now()}`);
  await assert.rejects(
    async () => {
      const prev = process.cwd();
      try {
        process.chdir(dir);
        await cmdInit({});
      } finally {
        process.chdir(prev);
      }
    },
    /No flux\.json found/,
  );
});

test("requireInitAuth fails when token is missing", async () => {
  const { requireInitAuth } = await import(`./init.ts?auth=${Date.now()}`);
  assert.throws(() => requireInitAuth(""), /Not authenticated.*flux login/i);
  assert.throws(() => requireInitAuth(null), /Not authenticated.*flux login/i);
});

test("mergeInitPatch via writeFluxJson after placeholder init shape", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flux-init-"));
  await writeFile(
    join(dir, "flux.json"),
    JSON.stringify({
      slug: "vessel-ledger",
      hash: FLUX_INIT_PLACEHOLDER_HASH,
      keepMe: 1,
    }),
    "utf8",
  );
  const { writeFluxJson } = await import(`../flux-config.ts?test=${Date.now()}`);
  await writeFluxJson(dir, {
    slug: "vessel-ledger",
    hash: "abc1234",
    apiUrl: "https://api--vessel-ledger--abc1234.vsl-base.com",
    mode: "v2_shared",
    apiSchema: "t_5ecfa3ab72d1_api",
  });
  const parsed = JSON.parse(
    await readFile(join(dir, "flux.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(parsed.keepMe, 1);
  assert.equal(parsed.hash, "abc1234");
  assert.equal(parsed.jwt_secret, undefined);
});

test("FLUX_INIT_NEXT_STEPS documents Foundry workflow", async () => {
  const { FLUX_INIT_NEXT_STEPS } = await import(`./init.ts?test=${Date.now()}`);
  assert.ok(
    FLUX_INIT_NEXT_STEPS.some((line: string) => line.includes("flux:schema:sync")),
  );
  assert.ok(
    FLUX_INIT_NEXT_STEPS.some((line: string) => line.includes("--plan")),
  );
});
