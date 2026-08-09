import {
  allowsProductionMutation,
  formatProductionBlockMessage,
  formatReadOnlyWarning,
  STALE_CLI_OVERRIDE_ENV,
  warnsOnReadOnly,
  type CliBuildProvenance,
  type ProvenanceVerdict,
} from "./cli-provenance";
import {
  inspectCliProvenance,
  type CliProvenanceReport,
} from "./cli-provenance-runtime";

/**
 * Commands that execute SQL against a tenant or destroy tenant resources. These fail closed
 * when the compiled artifact cannot be shown to match its source, because a stale bundle can
 * silently apply different SQL than the checkout describes.
 */
export const PRODUCTION_MUTATION_COMMANDS = [
  "push",
  "migrate",
  "db-reset",
  "db restore",
  "nuke",
  "reap",
] as const;

export function isStaleCliOverrideEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[STALE_CLI_OVERRIDE_ENV];
  return raw != null && raw !== "" && raw !== "0";
}

export class StaleCliArtifactError extends Error {
  readonly verdict: ProvenanceVerdict;
  readonly provenance: CliBuildProvenance;

  constructor(
    commandName: string,
    provenance: CliBuildProvenance,
    verdict: ProvenanceVerdict,
  ) {
    super(formatProductionBlockMessage(commandName, provenance, verdict));
    this.name = "StaleCliArtifactError";
    this.verdict = verdict;
    this.provenance = provenance;
  }
}

/**
 * Decide the outcome for a production-mutating command. Pure over an already-collected
 * report so the fail-closed matrix is testable without building bundles.
 */
export function evaluateProductionMutationGate(
  commandName: string,
  report: CliProvenanceReport,
  overrideEnabled: boolean,
): { allowed: boolean; error?: StaleCliArtifactError; overridden: boolean } {
  if (allowsProductionMutation(report.verdict.status)) {
    return { allowed: true, overridden: false };
  }
  if (overrideEnabled) return { allowed: true, overridden: true };
  return {
    allowed: false,
    error: new StaleCliArtifactError(
      commandName,
      report.provenance,
      report.verdict,
    ),
    overridden: false,
  };
}

/** Throws before any production-affecting work when artifact provenance is stale or unknown. */
export async function assertCliArtifactFreshForProduction(
  commandName: string,
): Promise<void> {
  const report = inspectCliProvenance();
  const gate = evaluateProductionMutationGate(
    commandName,
    report,
    isStaleCliOverrideEnabled(),
  );
  if (gate.error) throw gate.error;

  const { cliWarn, cliDimHint } = await import("../utils/cli-audience");
  if (gate.overridden) {
    cliWarn(
      `${STALE_CLI_OVERRIDE_ENV} is set: running \`flux ${commandName}\` with ${report.verdict.status} artifact provenance. ${report.verdict.detail}`,
    );
    return;
  }
  if (report.verdict.status === "unverifiable") {
    cliDimHint(`CLI provenance: ${report.verdict.detail}`);
  }
}

/** Read-only commands stay usable; surface broken correspondence without blocking. */
export async function warnIfCliArtifactStale(): Promise<void> {
  const report = inspectCliProvenance();
  if (!warnsOnReadOnly(report.verdict.status)) return;
  const { cliWarn } = await import("../utils/cli-audience");
  cliWarn(formatReadOnlyWarning(report.verdict));
}
