import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * End-to-end checks against the runnable artifact. Pure unit tests cannot prove that tsup
 * actually injected provenance, which is the failure mode that let a stale bundle run in
 * Stage 10. Skipped when `dist/` has not been built.
 */
const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bundlePath = resolve(packageDir, "dist/index.cjs");
const bundleMissing = !existsSync(bundlePath);

function runBundle(args: string[], env: NodeJS.ProcessEnv = {}) {
  try {
    const stdout = execFileSync(process.execPath, [bundlePath, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      code: e.status ?? 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
    };
  }
}

test(
  "built bundle reports embedded provenance via version --json",
  { skip: bundleMissing ? "dist/index.cjs not built" : false },
  () => {
    const { code, stdout } = runBundle(["version", "--json"]);
    assert.equal(code, 0);
    const info = JSON.parse(stdout) as Record<string, unknown>;
    assert.equal(info.runtime, "bundle", "define injection must have run");
    assert.equal(typeof info.sourceSha, "string");
    assert.match(String(info.sourceSha), /^[0-9a-f]{40}$/u);
    assert.equal(typeof info.buildTimestamp, "string");
    assert.equal(typeof info.version, "string");

    // A bundle built from a dirty tree is not described by any commit, so it must fail
    // closed; a bundle built from a clean tree must be checkable against the checkout.
    if (info.sourceDirtyAtBuild === true) {
      assert.equal(info.provenanceStatus, "unknown");
      assert.equal(info.productionMutationAllowed, false);
    } else {
      assert.equal(info.sourceDirtyAtBuild, false);
      assert.notEqual(
        info.provenanceStatus,
        "unknown",
        "a bundle built from a clean tree must have establishable provenance",
      );
    }
  },
);

test(
  "source runtime reports no build provenance",
  () => {
    const cli = resolve(packageDir, "src/index.ts");
    const stdout = execFileSync(
      process.execPath,
      [resolve(packageDir, "node_modules/tsx/dist/cli.mjs"), cli, "version", "--json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60_000 },
    );
    const info = JSON.parse(stdout) as Record<string, unknown>;
    assert.equal(info.runtime, "source");
    assert.equal(info.provenanceStatus, "source");
    assert.equal(info.productionMutationAllowed, true);
  },
);
