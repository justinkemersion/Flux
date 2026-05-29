import chalk from "chalk";
import { resolveDashboardBase } from "../dashboard-base";

/** Pinned in source; must match `packages/cli/package.json` and server `/api/install/cli/version` when published. */
const CLI_VERSION = "1.0.0";

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

export async function runVersionOutput(): Promise<void> {
  const { cliDimHint } = await import("../utils/cli-audience");
  console.log(CLI_VERSION);
  const remote = await fetchRemoteCliVersion();
  if (remote && isRemoteVersionNewer(remote, CLI_VERSION)) {
    cliDimHint(`Update available: ${remote} (current ${CLI_VERSION})`);
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
