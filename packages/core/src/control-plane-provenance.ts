/**
 * Provenance contract for the deployed Flux control plane.
 *
 * The pooled (v2_shared) push adapter runs in the deployed dashboard, not in the CLI, so a
 * verified CLI artifact says nothing about which code rewrote tenant SQL. This module defines
 * what the control plane advertises, how a client validates it, and the rule that decides
 * whether a production pooled migration may proceed.
 *
 * Pure module: no I/O, no framework imports, so both the producing dashboard and the consuming
 * CLI use identical logic and every verdict is directly testable.
 */

/** Provenance a deployed control plane advertises about its own build. */
export type ControlPlaneProvenance = {
  /** Dashboard package version. */
  version: string;
  /** Commit the deployed artifact was built from; null when the build could not establish it. */
  sourceSha: string | null;
  /** Whether the build tree had uncommitted tracked changes; null when unknown. */
  dirtyAtBuild: boolean | null;
  buildTimestamp: string | null;
  gatewayContractVersion: string | null;
  /** Behavioral contract of the pooled push SQL adapter compiled into this artifact. */
  pooledPushAdapterContract: string | null;
};

export type ControlPlaneProvenanceStatus =
  /** Provenance is present and internally consistent. */
  | "established"
  /** Reachable, but provenance is absent or incomplete (e.g. a build predating this contract). */
  | "unknown"
  /** Built from a tree with uncommitted changes, so no commit describes the running code. */
  | "dirty"
  /** The control plane could not be reached or did not answer with usable provenance. */
  | "unreachable";

export type ControlPlaneProvenanceVerdict = {
  status: ControlPlaneProvenanceStatus;
  detail: string;
};

const SHA_PATTERN = /^[0-9a-f]{7,40}$/u;

function str(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Validate an untrusted provenance payload (an HTTP response body) into the contract shape.
 * Returns null when the payload is not a provenance document at all.
 */
export function parseControlPlaneProvenance(
  input: unknown,
): ControlPlaneProvenance | null {
  if (input === null || typeof input !== "object") return null;
  const root = input as Record<string, unknown>;
  const source =
    root.provenance !== null && typeof root.provenance === "object"
      ? (root.provenance as Record<string, unknown>)
      : root;

  const version = str(source, "version");
  if (version == null) return null;

  const sha = str(source, "sourceSha");
  return {
    version,
    sourceSha: sha != null && SHA_PATTERN.test(sha.toLowerCase()) ? sha.toLowerCase() : null,
    dirtyAtBuild:
      typeof source.dirtyAtBuild === "boolean" ? source.dirtyAtBuild : null,
    buildTimestamp: str(source, "buildTimestamp"),
    gatewayContractVersion: str(source, "gatewayContractVersion"),
    pooledPushAdapterContract: str(source, "pooledPushAdapterContract"),
  };
}

export function classifyControlPlaneProvenance(
  provenance: ControlPlaneProvenance | null,
): ControlPlaneProvenanceVerdict {
  if (provenance == null) {
    return {
      status: "unreachable",
      detail:
        "Control plane did not return usable build provenance. It may predate the provenance contract or be unreachable.",
    };
  }
  if (provenance.sourceSha == null) {
    return {
      status: "unknown",
      detail:
        "Control plane reports no source commit, so the deployed code cannot be identified.",
    };
  }
  if (provenance.dirtyAtBuild === true) {
    return {
      status: "dirty",
      detail: `Control plane was built from a tree with uncommitted changes at ${shortSha(provenance.sourceSha)}, so no commit describes the running code.`,
    };
  }
  if (provenance.pooledPushAdapterContract == null) {
    return {
      status: "unknown",
      detail: `Control plane at ${shortSha(provenance.sourceSha)} advertises no pooled-push adapter contract.`,
    };
  }
  return {
    status: "established",
    detail: `Control plane runs ${shortSha(provenance.sourceSha)}, adapter contract ${provenance.pooledPushAdapterContract}.`,
  };
}

export function shortSha(sha: string | null): string {
  if (sha == null || sha.trim() === "") return "unknown";
  return sha.trim().slice(0, 12);
}

/** SHAs may be recorded at different lengths; compare on the shorter common prefix. */
export function sameSha(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return false;
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  const width = Math.min(left.length, right.length);
  if (width < 7) return false;
  return left.slice(0, width) === right.slice(0, width);
}

/** What the local checkout expects a compatible control plane to be running. */
export type ExpectedControlPlaneContracts = {
  pooledPushAdapterContract: string;
  gatewayContractVersion: string;
  /** Local Flux checkout HEAD, used for reporting and for the strict SHA-equality rule. */
  localSourceSha: string | null;
  /** Enforce deployed SHA == local checkout SHA in addition to contract agreement. */
  requireShaMatch?: boolean;
};

export type MigrationReadinessReason = {
  code:
    | "control_plane_unreachable"
    | "control_plane_unknown"
    | "control_plane_dirty"
    | "adapter_contract_mismatch"
    | "gateway_contract_mismatch"
    | "sha_mismatch";
  detail: string;
};

export type MigrationReadiness = {
  ready: boolean;
  verdict: ControlPlaneProvenanceVerdict;
  reasons: MigrationReadinessReason[];
  /** True when deployed SHA equals the local checkout; reported even when not required. */
  shaMatchesLocal: boolean;
};

/**
 * Decide whether a pooled production migration may be handled by this control plane.
 *
 * The rule gates on **contract agreement**, not SHA equality, because the adapter contract is
 * pinned to the adapter source by a digest test: any behavioral change to the code that
 * rewrites tenant SQL forces a contract bump. Requiring SHA equality instead would block every
 * application migration on an unrelated Flux commit and manufacture deploy pressure during
 * security work. Operators who want the strictest coupling set `requireShaMatch`.
 */
export function evaluateMigrationReadiness(
  provenance: ControlPlaneProvenance | null,
  expected: ExpectedControlPlaneContracts,
): MigrationReadiness {
  const verdict = classifyControlPlaneProvenance(provenance);
  const reasons: MigrationReadinessReason[] = [];
  const shaMatchesLocal = sameSha(
    provenance?.sourceSha ?? null,
    expected.localSourceSha,
  );

  if (verdict.status === "unreachable") {
    reasons.push({ code: "control_plane_unreachable", detail: verdict.detail });
  } else if (verdict.status === "unknown") {
    reasons.push({ code: "control_plane_unknown", detail: verdict.detail });
  } else if (verdict.status === "dirty") {
    reasons.push({ code: "control_plane_dirty", detail: verdict.detail });
  }

  if (provenance != null && verdict.status === "established") {
    if (
      provenance.pooledPushAdapterContract !== expected.pooledPushAdapterContract
    ) {
      reasons.push({
        code: "adapter_contract_mismatch",
        detail: `Deployed pooled-push adapter contract is ${provenance.pooledPushAdapterContract}, this checkout expects ${expected.pooledPushAdapterContract}.`,
      });
    }
    if (
      provenance.gatewayContractVersion !== expected.gatewayContractVersion
    ) {
      reasons.push({
        code: "gateway_contract_mismatch",
        detail: `Deployed gateway contract is ${provenance.gatewayContractVersion ?? "unknown"}, this checkout expects ${expected.gatewayContractVersion}.`,
      });
    }
    if (expected.requireShaMatch === true && !shaMatchesLocal) {
      reasons.push({
        code: "sha_mismatch",
        detail: `Deployed control plane is ${shortSha(provenance.sourceSha)}, local checkout is ${shortSha(expected.localSourceSha)}.`,
      });
    }
  }

  return { ready: reasons.length === 0, verdict, reasons, shaMatchesLocal };
}

/** Field names a provenance response must never contain. */
export const FORBIDDEN_PROVENANCE_FIELDS = [
  "buildRepoRoot",
  "repoRoot",
  "path",
  "cwd",
  "env",
  "secret",
  "token",
  "password",
  "jwt",
  "tenant",
  "tenantId",
  "hash",
  "credentials",
  "connectionString",
] as const;
