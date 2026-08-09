import {
  FLUX_GATEWAY_CONTRACT_VERSION,
  FLUX_POOLED_PUSH_ADAPTER_CONTRACT,
} from "@flux/core/contract-versions";
import {
  evaluateMigrationReadiness,
  parseControlPlaneProvenance,
  shortSha,
  type ControlPlaneProvenance,
  type ExpectedControlPlaneContracts,
  type MigrationReadiness,
} from "@flux/core/control-plane-provenance";
import { resolveDashboardBase } from "../dashboard-base";
import {
  inspectCliProvenance,
  type CliProvenanceReport,
} from "./cli-provenance-runtime";

export const UNVERIFIED_CONTROL_PLANE_OVERRIDE_ENV =
  "FLUX_ALLOW_UNVERIFIED_CONTROL_PLANE";

export function isControlPlaneOverrideEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[UNVERIFIED_CONTROL_PLANE_OVERRIDE_ENV];
  return raw != null && raw !== "" && raw !== "0";
}

export type ControlPlanePreflight = {
  baseUrl: string;
  provenance: ControlPlaneProvenance | null;
  expected: ExpectedControlPlaneContracts;
  readiness: MigrationReadiness;
  cli: CliProvenanceReport;
};

export function controlPlaneHealthUrl(base: string): string {
  return new URL("/api/health", base.endsWith("/") ? base : `${base}/`).href;
}

/**
 * Read provenance from a deployed control plane. A control plane that predates the provenance
 * contract answers 404, which parses to null and classifies as unreachable — fail closed.
 */
export async function fetchControlPlaneProvenance(
  baseUrl: string,
  timeoutMs = 8000,
): Promise<ControlPlaneProvenance | null> {
  try {
    const res = await fetch(controlPlaneHealthUrl(baseUrl), {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return parseControlPlaneProvenance(await res.json());
  } catch {
    return null;
  }
}

/**
 * What this checkout expects of a compatible control plane.
 *
 * Contract identifiers are compiled in from `@flux/core`, so they describe this CLI's own
 * source rather than operator input. The local Flux commit is the current checkout HEAD when
 * one is present, otherwise the commit this bundle was built from.
 */
export function resolveExpectedContracts(
  cli: CliProvenanceReport,
  requireShaMatch: boolean,
): ExpectedControlPlaneContracts {
  return {
    pooledPushAdapterContract: FLUX_POOLED_PUSH_ADAPTER_CONTRACT,
    gatewayContractVersion: FLUX_GATEWAY_CONTRACT_VERSION,
    localSourceSha: cli.checkout?.headSha ?? cli.provenance.sourceSha,
    ...(requireShaMatch ? { requireShaMatch: true } : {}),
  };
}

export async function inspectControlPlane(
  options: { requireShaMatch?: boolean } = {},
): Promise<ControlPlanePreflight> {
  const baseUrl = resolveDashboardBase();
  const cli = inspectCliProvenance();
  const expected = resolveExpectedContracts(
    cli,
    options.requireShaMatch === true,
  );
  const provenance = await fetchControlPlaneProvenance(baseUrl);
  return {
    baseUrl,
    provenance,
    expected,
    readiness: evaluateMigrationReadiness(provenance, expected),
    cli,
  };
}

function line(label: string, value: string): string {
  return `  ${label.padEnd(26)}${value}`;
}

/** Operator-facing report: both controls side by side, then the readiness verdict. */
export function formatControlPlaneReport(p: ControlPlanePreflight): string {
  const out = [
    "Flux migration readiness",
    "",
    "CLI artifact",
    line("provenance", `${p.cli.verdict.status} — ${p.cli.verdict.detail}`),
    line("version", p.cli.provenance.version),
    line("built from", shortSha(p.cli.provenance.sourceSha)),
    "",
    "Local checkout",
    line("head", shortSha(p.expected.localSourceSha)),
    line("expects adapter contract", p.expected.pooledPushAdapterContract),
    line("expects gateway contract", p.expected.gatewayContractVersion),
    "",
    "Deployed control plane",
    line("endpoint", controlPlaneHealthUrl(p.baseUrl)),
    line("provenance", `${p.readiness.verdict.status} — ${p.readiness.verdict.detail}`),
  ];
  if (p.provenance) {
    out.push(
      line("version", p.provenance.version),
      line("source sha", shortSha(p.provenance.sourceSha)),
      line("built at", p.provenance.buildTimestamp ?? "unknown"),
      line("adapter contract", p.provenance.pooledPushAdapterContract ?? "unknown"),
      line("gateway contract", p.provenance.gatewayContractVersion ?? "unknown"),
      line("matches local checkout", p.readiness.shaMatchesLocal ? "yes" : "no"),
    );
  }
  out.push("");
  if (p.readiness.ready && cliArtifactAllowsProduction(p)) {
    out.push("READY — pooled production migrations may proceed.");
  } else {
    out.push("NOT READY — pooled production migrations are refused:");
    if (!cliArtifactAllowsProduction(p)) {
      out.push(`  - cli_artifact: ${p.cli.verdict.detail}`);
    }
    for (const reason of p.readiness.reasons) {
      out.push(`  - ${reason.code}: ${reason.detail}`);
    }
  }
  return out.join("\n");
}

function cliArtifactAllowsProduction(p: ControlPlanePreflight): boolean {
  return p.cli.verdict.status !== "stale" && p.cli.verdict.status !== "unknown";
}

export function formatPooledBlockMessage(p: ControlPlanePreflight): string {
  const lines = [
    "Refusing to apply a pooled (v2_shared) migration: the deployed control plane is not a verified compatible build.",
    "",
    "The pooled push SQL adapter runs in the control plane, not in this CLI, so a verified",
    "CLI artifact does not establish which code will rewrite your SQL.",
    "",
    line("endpoint", controlPlaneHealthUrl(p.baseUrl)),
    line("status", p.readiness.verdict.status),
  ];
  for (const reason of p.readiness.reasons) {
    lines.push(line(reason.code, reason.detail));
  }
  lines.push(
    "",
    "Deploy the reviewed Flux control plane, then re-check:",
    "",
    "  bash bin/deploy-web.sh          # on the control-plane host",
    "  flux control-plane verify",
    "",
    `Emergency override (documented exception only): ${UNVERIFIED_CONTROL_PLANE_OVERRIDE_ENV}=1`,
  );
  return lines.join("\n");
}

export class UnverifiedControlPlaneError extends Error {
  readonly preflight: ControlPlanePreflight;

  constructor(preflight: ControlPlanePreflight) {
    super(formatPooledBlockMessage(preflight));
    this.name = "UnverifiedControlPlaneError";
    this.preflight = preflight;
  }
}

/**
 * Fail closed before a pooled production migration when the deployed control plane cannot be
 * shown to be the reviewed build.
 */
export async function assertControlPlaneReadyForPooledMigration(): Promise<void> {
  const preflight = await inspectControlPlane();
  if (preflight.readiness.ready) return;

  const { cliWarn } = await import("../utils/cli-audience");
  if (isControlPlaneOverrideEnabled()) {
    cliWarn(
      `${UNVERIFIED_CONTROL_PLANE_OVERRIDE_ENV} is set: applying a pooled migration against an unverified control plane (${preflight.readiness.verdict.status}). ${preflight.readiness.verdict.detail}`,
    );
    return;
  }
  throw new UnverifiedControlPlaneError(preflight);
}
