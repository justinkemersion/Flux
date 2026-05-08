import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import assert from "node:assert/strict";
import {
  HOSTED_FLUX_PUBLIC_API_BASE,
  hydrateProcessEnvFromProjectFiles,
  inferHostedFluxApiBaseFromFluxUrl,
  loadMergedProjectEnvFiles,
  parseEnvFile,
  resolveFluxProjectRootForEnv,
} from "./env-file";

test("parseEnvFile handles plain KEY=value lines", () => {
  const out = parseEnvFile("FOO=bar\nBAZ=qux\n");
  assert.deepEqual(out, { FOO: "bar", BAZ: "qux" });
});

test("parseEnvFile strips surrounding double and single quotes", () => {
  const out = parseEnvFile(`A="hello world"\nB='single quoted'\n`);
  assert.equal(out.A, "hello world");
  assert.equal(out.B, "single quoted");
});

test("parseEnvFile skips blank lines and comments", () => {
  const out = parseEnvFile("\n# comment\nFOO=1\n  # indented comment\nBAR=2\n");
  assert.deepEqual(out, { FOO: "1", BAR: "2" });
});

test("parseEnvFile preserves first occurrence and ignores subsequent duplicates", () => {
  const out = parseEnvFile("X=first\nX=second\n");
  assert.equal(out.X, "first");
});

test("parseEnvFile keeps empty values", () => {
  const out = parseEnvFile("EMPTY=\n");
  assert.equal(out.EMPTY, "");
});

test("parseEnvFile ignores lines without an equals sign", () => {
  const out = parseEnvFile("not a kv line\nKEY=value\n");
  assert.deepEqual(out, { KEY: "value" });
});

test("parseEnvFile resolves a typical FLUX_GATEWAY_JWT_SECRET line", () => {
  const text = `# flux project credentials
FLUX_GATEWAY_JWT_SECRET=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
OTHER=value
`;
  const out = parseEnvFile(text);
  assert.equal(
    out.FLUX_GATEWAY_JWT_SECRET,
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  );
});

test("loadMergedProjectEnvFiles lets .env.local override .env", async () => {
  const root = await mkdtemp(join(tmpdir(), "flux-cli-env-"));
  await writeFile(join(root, ".env"), "FLUX_API_BASE=https://from-env.example/api\n", "utf8");
  await writeFile(
    join(root, ".env.local"),
    "FLUX_API_BASE=https://from-local.example/api\n",
    "utf8",
  );
  const merged = await loadMergedProjectEnvFiles(root);
  assert.equal(merged.FLUX_API_BASE, "https://from-local.example/api");
});

test("resolveFluxProjectRootForEnv walks up to flux.json", async () => {
  const root = await mkdtemp(join(tmpdir(), "flux-cli-root-"));
  await writeFile(join(root, "flux.json"), JSON.stringify({ slug: "a", hash: "abcd123" }), "utf8");
  const nested = join(root, "apps", "web");
  await mkdir(nested, { recursive: true });
  const resolved = await resolveFluxProjectRootForEnv(nested);
  assert.equal(resolved, root);
});

test("hydrateProcessEnvFromProjectFiles does not override existing process.env", async () => {
  const root = await mkdtemp(join(tmpdir(), "flux-cli-hydr-"));
  await writeFile(join(root, "flux.json"), JSON.stringify({ slug: "a", hash: "abcd123" }), "utf8");
  await writeFile(join(root, ".env"), "FLUX_API_BASE=https://file.example/api\n", "utf8");
  const prev = process.env.FLUX_API_BASE;
  process.env.FLUX_API_BASE = "https://shell.example/api";
  try {
    await hydrateProcessEnvFromProjectFiles(root);
    assert.equal(process.env.FLUX_API_BASE, "https://shell.example/api");
  } finally {
    if (prev === undefined) delete process.env.FLUX_API_BASE;
    else process.env.FLUX_API_BASE = prev;
  }
});

test("hydrateProcessEnvFromProjectFiles fills FLUX_API_BASE from project .env", async () => {
  const root = await mkdtemp(join(tmpdir(), "flux-cli-hydr2-"));
  await writeFile(join(root, "flux.json"), JSON.stringify({ slug: "a", hash: "abcd123" }), "utf8");
  await writeFile(join(root, ".env"), "FLUX_API_BASE=https://from-file.example/api\n", "utf8");
  const prev = process.env.FLUX_API_BASE;
  delete process.env.FLUX_API_BASE;
  try {
    await hydrateProcessEnvFromProjectFiles(root);
    assert.equal(process.env.FLUX_API_BASE, "https://from-file.example/api");
  } finally {
    if (prev === undefined) delete process.env.FLUX_API_BASE;
    else process.env.FLUX_API_BASE = prev;
  }
});

test("inferHostedFluxApiBaseFromFluxUrl accepts flattened tenant Service URL", () => {
  assert.equal(
    inferHostedFluxApiBaseFromFluxUrl(
      "https://api--bloom-atelier--61d9dff.vsl-base.com",
    ),
    HOSTED_FLUX_PUBLIC_API_BASE,
  );
});

test("inferHostedFluxApiBaseFromFluxUrl accepts legacy dotted tenant host", () => {
  assert.equal(
    inferHostedFluxApiBaseFromFluxUrl("https://api.bloom-atelier.61d9dff.vsl-base.com"),
    HOSTED_FLUX_PUBLIC_API_BASE,
  );
});

test("inferHostedFluxApiBaseFromFluxUrl returns null for custom domains", () => {
  assert.equal(
    inferHostedFluxApiBaseFromFluxUrl("https://api--myapp--61d9dff.example.com"),
    null,
  );
});

test("hydrateProcessEnvFromProjectFiles infers FLUX_API_BASE from FLUX_URL when unset", async () => {
  const root = await mkdtemp(join(tmpdir(), "flux-cli-hydr3-"));
  await writeFile(join(root, "flux.json"), JSON.stringify({ slug: "a", hash: "abcd123" }), "utf8");
  await writeFile(
    join(root, ".env"),
    "FLUX_URL=https://api--bloom-atelier--61d9dff.vsl-base.com\n",
    "utf8",
  );
  const prevBase = process.env.FLUX_API_BASE;
  const prevUrl = process.env.FLUX_URL;
  delete process.env.FLUX_API_BASE;
  delete process.env.FLUX_URL;
  try {
    await hydrateProcessEnvFromProjectFiles(root);
    assert.equal(process.env.FLUX_API_BASE, HOSTED_FLUX_PUBLIC_API_BASE);
  } finally {
    if (prevBase === undefined) delete process.env.FLUX_API_BASE;
    else process.env.FLUX_API_BASE = prevBase;
    if (prevUrl === undefined) delete process.env.FLUX_URL;
    else process.env.FLUX_URL = prevUrl;
  }
});
