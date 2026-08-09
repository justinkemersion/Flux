import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLI_VERSION } from "./cli-build-version.ts";
import { parseVersionInvocation } from "./version-invocation.ts";

test("pinned CLI_VERSION matches package.json", () => {
  const pkgPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../package.json",
  );
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  assert.equal(
    CLI_VERSION,
    pkg.version,
    "bump src/lib/cli-build-version.ts with package.json",
  );
});

test("version invocations are recognized with and without --json", () => {
  for (const token of ["-V", "--version", "version"]) {
    assert.deepEqual(parseVersionInvocation([token]), { json: false });
    assert.deepEqual(parseVersionInvocation([token, "--json"]), { json: true });
  }
});

test("non-version invocations fall through to Commander", () => {
  assert.equal(parseVersionInvocation([]), null);
  assert.equal(parseVersionInvocation(["push"]), null);
  assert.equal(parseVersionInvocation(["version", "--bogus"]), null);
  assert.equal(parseVersionInvocation(["version", "--json", "extra"]), null);
  assert.equal(parseVersionInvocation(["--json"]), null);
});
