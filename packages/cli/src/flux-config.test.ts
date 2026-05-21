import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FLUX_INIT_PLACEHOLDER_HASH,
  isFluxInitPlaceholderHash,
  readFluxJson,
  readFluxJsonRaw,
  writeFluxJson,
} from "./flux-config";

test("isFluxInitPlaceholderHash detects Foundry placeholder", () => {
  assert.equal(isFluxInitPlaceholderHash("REPLACE_AFTER_FLUX_INIT"), true);
  assert.equal(isFluxInitPlaceholderHash("abc1234"), false);
});

test("readFluxJsonRaw preserves placeholder hash casing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flux-json-"));
  await writeFile(
    join(dir, "flux.json"),
    JSON.stringify({ slug: "app", hash: "replace_after_flux_init" }),
    "utf8",
  );
  const raw = await readFluxJsonRaw(dir);
  assert.equal(raw?.hash, FLUX_INIT_PLACEHOLDER_HASH);
});

test("readFluxJsonRaw allows placeholder hash", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flux-json-"));
  await writeFile(
    join(dir, "flux.json"),
    JSON.stringify({ slug: "vessel-ledger", hash: FLUX_INIT_PLACEHOLDER_HASH }),
    "utf8",
  );
  const raw = await readFluxJsonRaw(dir);
  assert.equal(raw?.hash, FLUX_INIT_PLACEHOLDER_HASH);
  assert.equal(raw?.slug, "vessel-ledger");
});

test("readFluxJson rejects placeholder with init message", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flux-json-"));
  await writeFile(
    join(dir, "flux.json"),
    JSON.stringify({ slug: "app", hash: FLUX_INIT_PLACEHOLDER_HASH }),
    "utf8",
  );
  await assert.rejects(
    () => readFluxJson(dir),
    /project not initialized.*flux init/i,
  );
});

test("writeFluxJson preserves unknown fields and omits secrets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flux-json-"));
  await writeFile(
    join(dir, "flux.json"),
    JSON.stringify({
      slug: "app",
      hash: FLUX_INIT_PLACEHOLDER_HASH,
      extra: true,
      jwt_secret: "must-not-persist",
    }),
    "utf8",
  );
  await writeFluxJson(dir, {
    slug: "app",
    hash: "a1b2c3d",
    apiUrl: "https://api--app--a1b2c3d.example.com",
    mode: "v2_shared",
    apiSchema: "t_5ecfa3ab72d1_api",
  });
  const text = await readFile(join(dir, "flux.json"), "utf8");
  const parsed = JSON.parse(text) as Record<string, unknown>;
  assert.equal(parsed.extra, true);
  assert.equal(parsed.hash, "a1b2c3d");
  assert.equal(parsed.mode, "v2_shared");
  assert.equal(parsed.jwt_secret, undefined);
  assert.equal(parsed.projectJwtSecret, undefined);
});
