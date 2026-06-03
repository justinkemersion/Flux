#!/usr/bin/env tsx
/**
 * SQL composition safety guardrail for the Flux monorepo.
 *
 * Catches double-terminated statement interpolation at authoring time
 * (e.g. `${FLUX_MIGRATIONS_TABLE_DDL};` inside a DO $$ block).
 *
 * Rendered-output validation (/\);[\s\n]*;/, `;;`) lives in unit tests via
 * packages/core/src/test/sql-assertions.ts.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

const REPO_ROOT = process.cwd();

const SCAN_ROOTS = [
  "packages/core/src",
  "apps/dashboard/src/lib",
];

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

/** Reject `${IDENT};` when IDENT ends with DDL, SQL, or STATEMENT. */
const DOUBLE_TERMINATED_EMBED_RE =
  /\$\{[A-Z0-9_]+(?:DDL|SQL|STATEMENT)\};/g;

const errors: string[] = [];

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
    } else if (st.isFile() && SOURCE_EXTENSIONS.has(extname(entry))) {
      yield full;
    }
  }
}

function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function checkDoubleTerminatedEmbed(rel: string, content: string): void {
  for (const match of content.matchAll(DOUBLE_TERMINATED_EMBED_RE)) {
    const idx = match.index ?? 0;
    errors.push(
      `${rel}:${String(lineNumberAt(content, idx))}: double-terminated SQL embed ` +
        `"${match[0]}" — use embedSqlStatement() instead of appending ";"`,
    );
  }
}

/** Heuristic: spaced double semicolon inside template literals. */
function checkSpacedDoubleSemicolonInTemplates(
  rel: string,
  content: string,
): void {
  const templateRe = /`[^`]*; ;[^`]*`/g;
  for (const match of content.matchAll(templateRe)) {
    const idx = match.index ?? 0;
    errors.push(
      `${rel}:${String(lineNumberAt(content, idx))}: spaced double semicolon "; ;" in template literal`,
    );
  }
}

function checkFile(rel: string, content: string): void {
  checkDoubleTerminatedEmbed(rel, content);
  checkSpacedDoubleSemicolonInTemplates(rel, content);
}

for (const root of SCAN_ROOTS) {
  const start = join(REPO_ROOT, root);
  for (const file of walkSourceFiles(start)) {
    const rel = toPosix(relative(REPO_ROOT, file));
    const content = readFileSync(file, "utf8");
    checkFile(rel, content);
  }
}

for (const e of errors) {
  console.error(`error: ${e}`);
}

if (errors.length > 0) {
  console.error(
    `\nSQL composition check failed: ${errors.length} error(s).`,
  );
  process.exit(1);
}

console.log("SQL composition check passed.");
