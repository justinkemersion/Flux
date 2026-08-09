#!/usr/bin/env node
/**
 * Verify build provenance on the real dashboard artifact.
 *
 * Unit tests can only show that helpers read the right fields. They cannot show that
 * `next build` inlined the commit, which is the property the whole control-plane guard rests
 * on: if the value were read at runtime instead, a container environment variable could
 * impersonate the deployed commit and the deploy guard would verify nothing.
 *
 * Run after a build:
 *   FLUX_BUILD_SOURCE_SHA=<sha> FLUX_BUILD_DIRTY=0 pnpm --filter dashboard build
 *   node apps/dashboard/scripts/verify-build-provenance.mjs <sha>
 *
 * Checks:
 *   1. the compiled server output contains the commit as a literal (compile-time inlining)
 *   2. the built server serves it at /api/health
 *   3. a conflicting runtime environment variable cannot change what is served
 *   4. the response carries no secrets, paths or tenant identifiers
 */
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dashboardDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedSha = process.argv[2];

if (!expectedSha || !/^[0-9a-f]{7,40}$/u.test(expectedSha)) {
  fail(`usage: verify-build-provenance.mjs <expected-sha>  (got ${expectedSha ?? "nothing"})`);
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`ok: ${message}`);
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && /\.(js|cjs|mjs)$/u.test(entry.name)) yield full;
  }
}

// ---------------------------------------------------------------- 1. inlining
const serverDir = join(dashboardDir, ".next/server");
try {
  statSync(serverDir);
} catch {
  fail(`${serverDir} not found — build the dashboard first`);
}

let inlinedIn = null;
for (const file of walk(serverDir)) {
  if (readFileSync(file, "utf8").includes(expectedSha)) {
    inlinedIn = file;
    break;
  }
}
if (inlinedIn == null) {
  fail(
    `commit ${expectedSha.slice(0, 12)} is not a literal in ${serverDir}.\n` +
      "      Provenance would then be read at runtime and could be forged by the container env.",
  );
}
pass(`commit inlined at build time (${inlinedIn.replace(dashboardDir, ".")})`);

// -------------------------------------------------- 2–4. serve and probe
const standalone = join(dashboardDir, ".next/standalone/apps/dashboard/server.js");
try {
  statSync(standalone);
} catch {
  fail(`${standalone} not found — build with output: "standalone"`);
}

const port = Number(process.env.FLUX_PROVENANCE_PROBE_PORT ?? 3131);
const forgedSha = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

const server = spawn(process.execPath, [standalone], {
  cwd: join(dashboardDir, ".next/standalone"),
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    // The forgery attempt: same names the build used, different values at runtime.
    FLUX_BUILD_SOURCE_SHA: forgedSha,
    FLUX_BUILD_DIRTY: "1",
    FLUX_BUILD_TIMESTAMP: "1999-01-01T00:00:00Z",
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "provenance-probe-secret",
    AUTH_SECRET: process.env.AUTH_SECRET ?? "provenance-probe-secret",
    AUTH_TRUST_HOST: "true",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d.toString()));
server.stderr.on("data", (d) => (serverLog += d.toString()));

const cleanup = () => {
  try {
    server.kill("SIGKILL");
  } catch {
    /* already gone */
  }
};
process.on("exit", cleanup);

async function probe() {
  const deadline = Date.now() + 60_000;
  let lastError = "no attempt";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) return await res.json();
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (server.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail(`could not read /api/health (${lastError})\n${serverLog.slice(-1500)}`);
}

const body = await probe();
const served = body?.provenance ?? {};

if (served.sourceSha !== expectedSha) {
  fail(`served sourceSha ${served.sourceSha} !== built ${expectedSha}`);
}
pass(`built server serves the compiled commit (${expectedSha.slice(0, 12)})`);

if (served.sourceSha === forgedSha || served.dirtyAtBuild === true) {
  fail("runtime environment overrode compiled provenance — forgery is possible");
}
pass("runtime environment cannot forge compiled provenance");

if (body.provenanceStatus !== "established") {
  fail(`provenanceStatus is ${body.provenanceStatus}, expected established`);
}
pass(`provenanceStatus established, adapter contract ${served.pooledPushAdapterContract}`);

const serialized = JSON.stringify(body).toLowerCase();
for (const forbidden of ["secret", "token", "password", "jwt", "tenant", "/home/", "/app", "connectionstring"]) {
  if (serialized.includes(forbidden)) {
    fail(`response leaks '${forbidden}': ${JSON.stringify(body)}`);
  }
}
pass("response carries no secrets, paths or tenant identifiers");

cleanup();
console.log("\nAll real-artifact provenance checks passed.");
