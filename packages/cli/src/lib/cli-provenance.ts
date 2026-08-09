/**
 * Build-artifact provenance model for the CLI.
 *
 * The bundled `dist/index.cjs` is the binary operators actually invoke, so a bundle built
 * before a core fix silently executes the old logic. Version strings cannot detect that:
 * they are pinned in source and identical across builds. Provenance therefore carries the
 * source commit the bundle was produced from, and production mutations require that commit
 * to still match the checkout the bundle was built from.
 *
 * Pure module: no filesystem, git, or process access, so every verdict is directly testable.
 */

export type CliRuntimeKind = "source" | "bundle";

export type CliBuildProvenance = {
  /** `bundle` when provenance was injected at build time; `source` when running TypeScript directly. */
  runtime: CliRuntimeKind;
  version: string;
  /** Commit the bundle was built from; null when the build could not read git. */
  sourceSha: string | null;
  /** Whether the build tree had uncommitted changes; null when unknown. */
  sourceDirtyAtBuild: boolean | null;
  buildTimestamp: string | null;
  /** Repo the bundle was built from, used to locate the checkout to compare against. */
  buildRepoRoot: string | null;
};

/** Current state of the source checkout a bundle claims to have been built from. */
export type SourceCheckoutState = {
  headSha: string;
  dirty: boolean;
};

export type ProvenanceStatus =
  /** Executing TypeScript source directly; the running code *is* the checkout. */
  | "source"
  /** Bundle provenance matches the current source checkout. */
  | "verified"
  /** Provenance is established but no source checkout is present to compare against. */
  | "unverifiable"
  /** Bundle does not correspond to the current source checkout. */
  | "stale"
  /** Provenance is absent or incomplete; correspondence cannot be established. */
  | "unknown";

export type ProvenanceVerdict = {
  status: ProvenanceStatus;
  /** Operator-facing explanation of how the status was reached. */
  detail: string;
};

const MIN_SHA_COMPARE_LENGTH = 7;

/** SHAs may be recorded at different lengths; compare on the shorter common prefix. */
export function sameGitSha(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  const width = Math.min(left.length, right.length);
  if (width < MIN_SHA_COMPARE_LENGTH) return false;
  return left.slice(0, width) === right.slice(0, width);
}

export function shortSha(sha: string | null): string {
  if (sha == null || sha.trim() === "") return "unknown";
  return sha.trim().slice(0, 12);
}

/**
 * Decide whether the running artifact corresponds to the source checkout.
 *
 * `checkout` is null when the build repo is absent (installed release bundle) or unreadable.
 */
export function classifyCliArtifact(
  provenance: CliBuildProvenance,
  checkout: SourceCheckoutState | null,
): ProvenanceVerdict {
  if (provenance.runtime === "source") {
    return {
      status: "source",
      detail: "Running TypeScript source directly; no compiled artifact involved.",
    };
  }

  if (provenance.sourceSha == null || provenance.sourceSha.trim() === "") {
    return {
      status: "unknown",
      detail:
        "Compiled artifact carries no source commit. It predates build provenance or was built without git.",
    };
  }

  if (provenance.sourceDirtyAtBuild === true) {
    return {
      status: "unknown",
      detail: `Compiled artifact was built from a dirty tree at ${shortSha(provenance.sourceSha)}, so no commit describes its contents.`,
    };
  }

  if (checkout == null) {
    return {
      status: "unverifiable",
      detail: `Built from ${shortSha(provenance.sourceSha)}; no source checkout available to compare against.`,
    };
  }

  if (checkout.dirty) {
    return {
      status: "stale",
      detail: `Source checkout has uncommitted changes, so the artifact built at ${shortSha(provenance.sourceSha)} cannot match it.`,
    };
  }

  if (!sameGitSha(provenance.sourceSha, checkout.headSha)) {
    return {
      status: "stale",
      detail: `Artifact was built from ${shortSha(provenance.sourceSha)} but the source checkout is at ${shortSha(checkout.headSha)}.`,
    };
  }

  return {
    status: "verified",
    detail: `Artifact matches source checkout at ${shortSha(checkout.headSha)}.`,
  };
}

/**
 * Whether a production-mutating command may run.
 *
 * Fails closed on `stale` and `unknown`. `unverifiable` is permitted because a released
 * bundle installed without a checkout has established provenance and nothing local to
 * drift from; its provenance is printed instead of silently trusted.
 */
export function allowsProductionMutation(status: ProvenanceStatus): boolean {
  return status === "source" || status === "verified" || status === "unverifiable";
}

/** Read-only commands stay usable regardless of provenance, but warn when correspondence is broken. */
export function warnsOnReadOnly(status: ProvenanceStatus): boolean {
  return status === "stale" || status === "unknown";
}

export const STALE_CLI_OVERRIDE_ENV = "FLUX_ALLOW_STALE_CLI";

export function formatProductionBlockMessage(
  commandName: string,
  provenance: CliBuildProvenance,
  verdict: ProvenanceVerdict,
): string {
  const lines = [
    `Refusing to run \`flux ${commandName}\`: the compiled CLI cannot be shown to match its source.`,
    "",
    `  status         ${verdict.status}`,
    `  reason         ${verdict.detail}`,
    `  cli version    ${provenance.version}`,
    `  built from     ${shortSha(provenance.sourceSha)}`,
    `  built at       ${provenance.buildTimestamp ?? "unknown"}`,
    `  build repo     ${provenance.buildRepoRoot ?? "unknown"}`,
    "",
    "This command mutates production state, so it fails closed.",
    "Rebuild the CLI from the current checkout, then retry:",
    "",
    "  pnpm --filter @flux/cli build",
    "",
    "Inspect provenance at any time with `flux version --json`.",
    `Emergency override (documented exception only): ${STALE_CLI_OVERRIDE_ENV}=1`,
  ];
  return lines.join("\n");
}

export function formatReadOnlyWarning(verdict: ProvenanceVerdict): string {
  return `Compiled CLI provenance is ${verdict.status}: ${verdict.detail} Read-only command continues; rebuild before mutating production.`;
}
