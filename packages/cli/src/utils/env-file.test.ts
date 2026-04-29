import test from "node:test";
import assert from "node:assert/strict";
import { parseEnvFile } from "./env-file";

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
