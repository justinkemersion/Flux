import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

const packageDir = dirname(fileURLToPath(import.meta.url));

function git(args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", packageDir, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Provenance embedded in the bundle so the runnable artifact can be checked against the
 * source it was produced from. Deterministic inputs (commit, repo root, package version)
 * come from git and package.json at build time; nothing is inferred from mtime at runtime.
 * Dirtiness ignores untracked files, matching `readSourceCheckoutState`.
 */
function buildProvenanceJson(): string {
  const pkg = JSON.parse(
    readFileSync(`${packageDir}/package.json`, "utf8"),
  ) as { version?: unknown };
  const status = git(["status", "--porcelain", "--untracked-files=no"]);
  return JSON.stringify({
    version: typeof pkg.version === "string" ? pkg.version : null,
    sourceSha: git(["rev-parse", "HEAD"]),
    sourceDirtyAtBuild: status == null ? null : status !== "",
    buildTimestamp: new Date().toISOString(),
    buildRepoRoot: git(["rev-parse", "--show-toplevel"]),
  });
}

export default defineConfig({
  define: {
    __FLUX_BUILD_PROVENANCE__: JSON.stringify(buildProvenanceJson()),
  },
  entry: ["src/index.ts"],
  outDir: "dist",
  // CJS so bundled Commander (CJS + require(node builtins)) works; ESM output hits esbuild’s
  // unsupported dynamic `require("events")` inside wrapped CJS. Package remains `"type":"module"`
  // for `src/`; the published runnable artifact is `dist/index.cjs`.
  format: ["cjs"],
  platform: "node",
  target: "node20",
  clean: true,
  sourcemap: true,
  dts: {
    compilerOptions: {
      // DTS worker injects deprecated `baseUrl`; TS 6 wants this here, not only in tsconfig, to avoid TS5101.
      ignoreDeprecations: "6.0",
    },
  },
  treeshake: true,
  bundle: true,
  // Shebang comes from src/index.ts; avoid duplicating tsup banner (breaks tsup parse).
  outExtension: () => ({ js: ".cjs" }),
  // Single-file bundle for `curl …/api/install/cli | node` — no adjacent node_modules.
  // Do not bundle `@flux/core` (root): it pulls dockerode / native addons. Use `@flux/core/standalone` only.
  noExternal: [
    "@flux/core/backup-trust",
    "@flux/core/standalone",
    "@flux/sdk",
    "chalk",
    "commander",
    "open",
    "ora",
    "strip-ansi",
    "zod",
  ],
  external: [],
  esbuildOptions: (o) => {
    o.legalComments = "none";
  },
});
