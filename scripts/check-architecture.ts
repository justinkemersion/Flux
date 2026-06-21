#!/usr/bin/env tsx
/**
 * Lightweight architecture guardrail for the Flux monorepo.
 *
 * Rules enforced (see docs/ARCHITECTURE-CONTRACT.md):
 *   1. packages/core/src/index.ts is public re-exports only.
 *   2. packages/cli/src/index.ts stays a thin entrypoint.
 *   3. New source files cannot be named utils.ts / helpers.ts / misc.ts / common.ts
 *      unless explicitly allowlisted.
 *   4. Source files over SOURCE_WARN_LINES emit a warning (not a failure).
 *   5. Dashboard client bundle files may import @flux/core only via browser-safe subpaths
 *      (never the root barrel — see docs/ARCHITECTURE-CONTRACT.md).
 *
 * Errors fail CI with exit code 1. Warnings print but do not fail.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = process.cwd();

const CORE_INDEX = "packages/core/src/index.ts";
const CLI_INDEX = "packages/cli/src/index.ts";
const CLI_INDEX_MAX_LINES = 120;
const SOURCE_WARN_LINES = 800;

const SOURCE_ROOTS = ["packages", "apps"];
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  ".git",
  "coverage",
  ".turbo",
]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

const JUNK_DRAWER_NAMES = new Set(["utils.ts", "helpers.ts", "misc.ts", "common.ts"]);

/**
 * Allowlist of pre-existing junk-drawer files we accept (none today).
 * Use repo-relative POSIX paths. Add a comment explaining why each entry stays.
 */
const JUNK_DRAWER_ALLOWLIST = new Set<string>([]);

/**
 * @flux/core subpaths safe for Next.js client bundles (no dockerode / node:fs).
 * Keep in sync with docs/ARCHITECTURE-CONTRACT.md and apps/dashboard/AGENTS.md.
 */
export const DASHBOARD_CLIENT_SAFE_CORE_SUBPATHS = new Set([
  "api-schema-strategy",
  "backup-policy",
  "backup-trust",
  "database-access-gui",
  "standalone",
]);

/** Lib modules pulled into client graphs even without "use client". */
const DASHBOARD_CLIENT_BOUNDARY_LIB_FILES = new Set([
  "apps/dashboard/src/lib/project-db-access-copy.ts",
]);

const CORE_IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\sfrom\s+)?["']@flux\/core(?:\/([^"']+))?["']/g;

const errors: string[] = [];
const warnings: string[] = [];

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function* walkSourceFiles(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walkSourceFiles(full);
    } else if (st.isFile()) {
      yield full;
    }
  }
}

/**
 * packages/core/src/index.ts must contain only `export ... from "..."` re-exports
 * (and comments). Anything else — imports, locals, helpers — belongs in a sibling
 * module that gets re-exported.
 */
function checkCoreIndexIsReexportsOnly(): void {
  const abs = join(REPO_ROOT, CORE_INDEX);
  let content: string;
  try {
    content = readFileSync(abs, "utf8");
  } catch {
    errors.push(`${CORE_INDEX}: file is missing or unreadable`);
    return;
  }

  // Strip block and line comments, then collapse to non-empty trimmed lines
  // joined by spaces so we can split on `;` to recover statements.
  const stripped = content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())
    .filter((l) => l.length > 0)
    .join(" ");

  const statements = stripped
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Allowed forms:
  //   export * from "./mod";
  //   export * as ns from "./mod";
  //   export { a, b, type C } from "./mod";
  //   export type { A, B } from "./mod";
  const reexportRe =
    /^export\s+(?:\*(?:\s+as\s+\w+)?|(?:type\s+)?\{[\s\S]*?\})\s+from\s+["'][^"']+["']$/;

  for (const stmt of statements) {
    if (reexportRe.test(stmt)) continue;
    errors.push(
      `${CORE_INDEX} must contain only re-exports. Found:\n    ${stmt.slice(0, 200)}`,
    );
  }
}

/**
 * packages/cli/src/index.ts is just process wiring + commander bootstrap.
 * If it grows past the threshold, the new logic belongs in commands/, cli-handlers,
 * or output/.
 */
function checkCliIndexStaysThin(): void {
  const abs = join(REPO_ROOT, CLI_INDEX);
  let content: string;
  try {
    content = readFileSync(abs, "utf8");
  } catch {
    errors.push(`${CLI_INDEX}: file is missing or unreadable`);
    return;
  }
  const lineCount = content.split("\n").length;
  if (lineCount > CLI_INDEX_MAX_LINES) {
    errors.push(
      `${CLI_INDEX} is ${lineCount} lines, exceeds entrypoint threshold of ${CLI_INDEX_MAX_LINES}. ` +
        `Move logic into commands/, cli-handlers.ts, or output/.`,
    );
  }
}

/**
 * Walk packages/ and apps/, fail on disallowed file names, warn on huge files.
 */
function checkSourceTree(): void {
  for (const root of SOURCE_ROOTS) {
    const start = join(REPO_ROOT, root);
    for (const file of walkSourceFiles(start)) {
      const rel = toPosix(relative(REPO_ROOT, file));
      const name = basename(file);

      if (JUNK_DRAWER_NAMES.has(name) && !JUNK_DRAWER_ALLOWLIST.has(rel)) {
        errors.push(
          `Junk-drawer file name not allowed: ${rel}. ` +
            `Pick a name that describes the reason to change ` +
            `(see docs/ARCHITECTURE-CONTRACT.md).`,
        );
      }

      if (SOURCE_EXTENSIONS.has(extname(name))) {
        const lineCount = readFileSync(file, "utf8").split("\n").length;
        if (lineCount > SOURCE_WARN_LINES) {
          warnings.push(
            `${rel} is ${lineCount} lines (>${SOURCE_WARN_LINES}). Consider splitting by responsibility.`,
          );
        }
      }
    }
  }
}

function isDashboardClientBoundaryFile(relPosix: string, content: string): boolean {
  if (DASHBOARD_CLIENT_BOUNDARY_LIB_FILES.has(relPosix)) return true;
  if (!relPosix.startsWith("apps/dashboard/")) return false;
  return /["']use client["']/.test(content);
}

/**
 * Client components (and lib copy modules they import) must not import the @flux/core
 * root barrel — it re-exports ProjectManager/dockerode and breaks next build.
 */
export function findDashboardClientCoreImportViolations(
  relPosix: string,
  content: string,
): string[] {
  if (!isDashboardClientBoundaryFile(relPosix, content)) return [];

  const violations: string[] = [];
  for (const match of content.matchAll(CORE_IMPORT_RE)) {
    const subpath = match[1];
    const specifier = subpath ? `@flux/core/${subpath}` : "@flux/core";
    if (!subpath) {
      violations.push(
        `${relPosix}: client bundle must not import root ${specifier} — use a browser-safe subpath (see docs/ARCHITECTURE-CONTRACT.md).`,
      );
      continue;
    }
    if (!DASHBOARD_CLIENT_SAFE_CORE_SUBPATHS.has(subpath)) {
      violations.push(
        `${relPosix}: client bundle import ${specifier} is not allowlisted. ` +
          `Add a browser-safe subpath export in @flux/core or move logic server-side.`,
      );
    }
  }
  return violations;
}

function checkDashboardClientCoreImports(): void {
  const dashboardRoot = join(REPO_ROOT, "apps/dashboard");
  for (const file of walkSourceFiles(dashboardRoot)) {
    if (!SOURCE_EXTENSIONS.has(extname(file))) continue;
    const rel = toPosix(relative(REPO_ROOT, file));
    const content = readFileSync(file, "utf8");
    for (const violation of findDashboardClientCoreImportViolations(rel, content)) {
      errors.push(violation);
    }
  }
}

function runArchitectureChecks(): void {
  checkCoreIndexIsReexportsOnly();
  checkCliIndexStaysThin();
  checkSourceTree();
  checkDashboardClientCoreImports();

  for (const w of warnings) {
    console.warn(`warn: ${w}`);
  }
  for (const e of errors) {
    console.error(`error: ${e}`);
  }

  if (errors.length > 0) {
    console.error(
      `\nArchitecture check failed: ${errors.length} error(s), ${warnings.length} warning(s).`,
    );
    process.exit(1);
  }

  console.log(
    `Architecture check passed (${warnings.length} warning${warnings.length === 1 ? "" : "s"}).`,
  );
}

const isMain =
  process.argv[1] != null &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  runArchitectureChecks();
}
