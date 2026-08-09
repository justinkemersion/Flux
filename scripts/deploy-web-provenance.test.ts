import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Exercises the real bin/deploy-web.sh provenance gate.
 *
 * The gate runs before any docker command, so these cases are reachable without Docker: the
 * script must refuse to build when the deployed commit cannot be established. Deploying a
 * control plane of unknown provenance is what makes pooled migration readiness unprovable.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const deployScript = join(repoRoot, "bin/deploy-web.sh");

type RunResult = { code: number; stdout: string; stderr: string };

function runDeploy(fixtureRoot: string, env: Record<string, string> = {}): RunResult {
  try {
    const stdout = execFileSync("bash", [join(fixtureRoot, "bin/deploy-web.sh")], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

/**
 * A checkout-shaped fixture: real script, real git repo, stub compose file. `docker` is
 * shadowed by a failing stub on PATH so a test can never touch a real daemon; every case
 * below is expected to exit before reaching it.
 */
function makeFixture(options: { git: boolean; dirty: boolean }): string {
  const root = mkdtempSync(join(tmpdir(), "flux-deploy-prov-"));
  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(join(root, "docker/web"), { recursive: true });
  mkdirSync(join(root, "stub-bin"), { recursive: true });
  copyFileSync(deployScript, join(root, "bin/deploy-web.sh"));
  writeFileSync(join(root, "docker/web/.env"), "FLUX_TENANT_PROBE_GATEWAY_URL=http://x:4000\n");
  writeFileSync(join(root, "docker/web/docker-compose.yml"), "services: {}\n");
  writeFileSync(join(root, "tracked.txt"), "original\n");

  writeFileSync(
    join(root, "stub-bin/docker"),
    "#!/bin/sh\necho 'STUB DOCKER INVOKED' >&2\nexit 97\n",
  );
  execFileSync("chmod", ["+x", join(root, "stub-bin/docker")]);

  if (options.git) {
    const git = (args: string[]) =>
      execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
    git(["init", "-q"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "provenance test"]);
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "fixture"]);
    if (options.dirty) writeFileSync(join(root, "tracked.txt"), "modified\n");
  }
  return root;
}

function withFixture(
  options: { git: boolean; dirty: boolean },
  fn: (root: string) => void,
): void {
  const root = makeFixture(options);
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const stubPath = (root: string) => `${join(root, "stub-bin")}:${process.env.PATH ?? ""}`;

test("clean checkout resolves the expected commit and proceeds to build", () => {
  withFixture({ git: true, dirty: false }, (root) => {
    const sha = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const result = runDeploy(root, { PATH: stubPath(root) });

    assert.match(result.stdout, /Resolving source provenance/u);
    assert.match(
      result.stdout,
      new RegExp(`expected sha: ${sha.slice(0, 12)} \\(dirty=0\\)`, "u"),
    );
    // Proof it got past the gate: the only thing that stopped it was the docker stub.
    assert.match(result.stderr, /STUB DOCKER INVOKED/u);
  });
});

test("dirty tree is refused before anything is built", () => {
  withFixture({ git: true, dirty: true }, (root) => {
    const result = runDeploy(root, { PATH: stubPath(root) });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /refusing a production build/u);
    assert.match(result.stderr, /tracked\.txt/u);
    assert.match(result.stderr, /FLUX_DEPLOY_ALLOW_DIRTY=1/u);
    assert.ok(
      !result.stderr.includes("STUB DOCKER INVOKED"),
      "must fail closed before invoking docker",
    );
  });
});

test("dirty tree may be built only with the explicit documented override", () => {
  withFixture({ git: true, dirty: true }, (root) => {
    const result = runDeploy(root, {
      PATH: stubPath(root),
      FLUX_DEPLOY_ALLOW_DIRTY: "1",
    });

    assert.match(result.stdout, /FLUX_DEPLOY_ALLOW_DIRTY=1/u);
    assert.match(result.stdout, /dirty=1/u);
    assert.match(result.stdout, /refuse pooled\s+production migrations/u);
    assert.match(result.stderr, /STUB DOCKER INVOKED/u);
  });
});

test("a non-git checkout cannot be deployed", () => {
  withFixture({ git: false, dirty: false }, (root) => {
    const result = runDeploy(root, { PATH: stubPath(root) });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /not a git checkout/u);
    assert.ok(!result.stderr.includes("STUB DOCKER INVOKED"));
  });
});

test("restart-only skips the build gate and never claims a verified commit", () => {
  withFixture({ git: true, dirty: true }, (root) => {
    const result = runDeploy(root, {
      PATH: stubPath(root),
      FLUX_DEPLOY_RESTART_ONLY: "1",
    });

    // A restart deliberately reuses an existing image, so there is no source to verify.
    assert.ok(!result.stdout.includes("Resolving source provenance"));
    assert.ok(!result.stdout.includes("verified at /api/health"));
    assert.match(result.stderr, /STUB DOCKER INVOKED/u);
  });
});

test("the script verifies provenance over HTTP, never by image or file timestamps", () => {
  const source = execFileSync("cat", [deployScript], { encoding: "utf8" });
  assert.match(source, /api\/health/u);
  assert.match(source, /sourceSha/u);

  // Comments discuss mtime to explain why it is not used; only executable lines matter.
  const code = source
    .split("\n")
    .filter((l) => !/^\s*#/u.test(l))
    .join("\n");
  for (const forbidden of [/\.State\.StartedAt/u, /\.Created/u, /stat -c %Y/u, /mtime/u]) {
    assert.ok(
      !forbidden.test(code),
      `deploy verification must not depend on ${String(forbidden)}`,
    );
  }
});
