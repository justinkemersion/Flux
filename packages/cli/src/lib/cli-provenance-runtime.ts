import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { CLI_VERSION } from "./cli-build-version";
import {
  classifyCliArtifact,
  type CliBuildProvenance,
  type ProvenanceVerdict,
  type SourceCheckoutState,
} from "./cli-provenance";

/**
 * Replaced at build time by tsup `define` with a JSON string. Absent when running from
 * source, which is how `runtime: "source"` is detected without consulting mtime or env.
 */
declare const __FLUX_BUILD_PROVENANCE__: string | undefined;

function readInjectedProvenance(): string | null {
  // `typeof` on an undeclared identifier is safe; in bundles esbuild folds it to a literal.
  if (typeof __FLUX_BUILD_PROVENANCE__ !== "string") return null;
  return __FLUX_BUILD_PROVENANCE__;
}

function parseInjectedProvenance(raw: string): CliBuildProvenance {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const record =
    parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  const str = (key: string): string | null =>
    typeof record[key] === "string" && record[key] !== ""
      ? (record[key] as string)
      : null;
  return {
    runtime: "bundle",
    version: str("version") ?? CLI_VERSION,
    sourceSha: str("sourceSha"),
    sourceDirtyAtBuild:
      typeof record.sourceDirtyAtBuild === "boolean"
        ? record.sourceDirtyAtBuild
        : null,
    buildTimestamp: str("buildTimestamp"),
    buildRepoRoot: str("buildRepoRoot"),
  };
}

export function resolveCliBuildProvenance(): CliBuildProvenance {
  const raw = readInjectedProvenance();
  if (raw == null) {
    return {
      runtime: "source",
      version: CLI_VERSION,
      sourceSha: null,
      sourceDirtyAtBuild: null,
      buildTimestamp: null,
      buildRepoRoot: null,
    };
  }
  return parseInjectedProvenance(raw);
}

function git(repoRoot: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Read HEAD and dirtiness of the checkout a bundle was built from.
 *
 * Dirtiness ignores untracked files: an untracked file is not imported by committed code,
 * so it cannot change bundle behavior, while counting it would block on unrelated scratch
 * files and push operators toward the override.
 */
export function readSourceCheckoutState(
  provenance: CliBuildProvenance,
): SourceCheckoutState | null {
  const repoRoot = provenance.buildRepoRoot;
  if (repoRoot == null || !existsSync(repoRoot)) return null;
  const headSha = git(repoRoot, ["rev-parse", "HEAD"]);
  if (headSha == null || headSha === "") return null;
  const status = git(repoRoot, [
    "status",
    "--porcelain",
    "--untracked-files=no",
  ]);
  if (status == null) return null;
  return { headSha, dirty: status !== "" };
}

export type CliProvenanceReport = {
  provenance: CliBuildProvenance;
  checkout: SourceCheckoutState | null;
  verdict: ProvenanceVerdict;
};

export function inspectCliProvenance(): CliProvenanceReport {
  const provenance = resolveCliBuildProvenance();
  const checkout =
    provenance.runtime === "bundle"
      ? readSourceCheckoutState(provenance)
      : null;
  return {
    provenance,
    checkout,
    verdict: classifyCliArtifact(provenance, checkout),
  };
}
