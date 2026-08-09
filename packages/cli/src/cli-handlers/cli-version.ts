import chalk from "chalk";
import { resolveDashboardBase } from "../dashboard-base";
import { CLI_VERSION } from "../lib/cli-build-version";
import { inspectCliProvenance } from "../lib/cli-provenance-runtime";
import { allowsProductionMutation } from "../lib/cli-provenance";

/** Same origin as the dashboard; used for install bundle and version checks. */
const resolveInstallOrigin = resolveDashboardBase;

function isRemoteVersionNewer(remote: string, local: string): boolean {
  const pr = remote.split(/[.-]/u);
  const pl = local.split(/[.-]/u);
  const n = Math.max(pr.length, pl.length, 1);
  for (let i = 0; i < n; i++) {
    const a = parseInt(pr[i] ?? "0", 10);
    const b = parseInt(pl[i] ?? "0", 10);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

async function fetchRemoteCliVersion(): Promise<string | null> {
  const base = resolveInstallOrigin();
  const u = new URL(
    "/api/install/cli/version",
    base.endsWith("/") ? base : `${base}/`,
  );
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { version?: unknown };
    return typeof j.version === "string" ? j.version.trim() : null;
  } catch {
    return null;
  }
}

/** Machine-readable build provenance for operators and preflight scripts. */
export function buildVersionJson(): string {
  const { provenance, checkout, verdict } = inspectCliProvenance();
  return JSON.stringify(
    {
      version: provenance.version,
      runtime: provenance.runtime,
      sourceSha: provenance.sourceSha,
      sourceDirtyAtBuild: provenance.sourceDirtyAtBuild,
      buildTimestamp: provenance.buildTimestamp,
      buildRepoRoot: provenance.buildRepoRoot,
      sourceCheckout: checkout,
      provenanceStatus: verdict.status,
      provenanceDetail: verdict.detail,
      productionMutationAllowed: allowsProductionMutation(verdict.status),
    },
    null,
    2,
  );
}

export async function runVersionOutput(
  options: { json?: boolean } = {},
): Promise<void> {
  if (options.json === true) {
    console.log(buildVersionJson());
    return;
  }
  const { cliDimHint } = await import("../utils/cli-audience");
  const { provenance, verdict } = inspectCliProvenance();
  console.log(provenance.version);
  cliDimHint(`build: ${verdict.status} — ${verdict.detail}`);
  const remote = await fetchRemoteCliVersion();
  if (remote && isRemoteVersionNewer(remote, provenance.version)) {
    cliDimHint(`Update available: ${remote} (current ${provenance.version})`);
  }
}

export async function cmdUpdate(): Promise<void> {
  const origin = resolveInstallOrigin();
  const bundle = new URL(
    "/api/install/cli",
    origin.endsWith("/") ? origin : `${origin}/`,
  ).href;
  const v = await fetchRemoteCliVersion();
  console.log(
    chalk.dim("flux update — pull latest bundle, then run with node (Node 20+):"),
  );
  console.log();
  console.log(
    `  curl -fsSL ${bundle} -o /tmp/flux.cjs && node /tmp/flux.cjs --help`,
  );
  console.log();
  console.log(chalk.dim("Or copy to a dir on PATH:"));
  console.log(
    `  curl -fsSL ${bundle} -o flux && chmod +x flux && mv flux ~/.local/bin/`,
  );
  if (v) {
    console.log();
    console.log(chalk.dim(`Control plane version: ${v}`));
  }
}
