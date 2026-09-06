/**
 * Error-only Docker/host watcher. Quiet when healthy.
 * Emails via sendOpsAlert (FLUX_ALERT_EMAIL_* / FLUX_RESEND_API_KEY).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { projects } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";
import { formatOpsAlertBody, sendOpsAlert } from "@/src/lib/ops-alert-email";
import {
  classifyContainer,
  classifyDiskSample,
  classifyLogScan,
  DEFAULT_OPS_WATCH_DISK_ALERT_PERCENT,
  DEFAULT_OPS_WATCH_INTERVAL_MS,
  DEFAULT_OPS_WATCH_LOG_CONTAINERS,
  DEFAULT_OPS_WATCH_LOG_MINUTES,
  EXPECTED_V2_CONTAINERS,
  isFluxNamedContainer,
  isIgnoredOpsWatchContainer,
  isSystemDbContainer,
  missingCoreFinding,
  normalizeContainerName,
  parsePosixDf,
  REQUIRED_CORE_CONTAINERS,
  type CatalogProjectRef,
  type ContainerSnapshot,
  type DiskSample,
  type OpsWatchFinding,
} from "@/src/lib/ops-watch-classify";

const execFileAsync = promisify(execFile);

const DOCKER_TIMEOUT_MS = 45_000;
const DISK_HELPER_NAME = "flux-ops-watch-df";

export type OpsWatchEnv = Record<string, string | undefined>;

export type OpsWatchConfig = {
  enabled: boolean;
  intervalMs: number;
  diskAlertPercent: number;
  logMinutes: number;
  logContainers: string[];
};

export type OpsWatchDockerFn = (args: string[]) => Promise<string>;

export type OpsWatchDeps = {
  env?: OpsWatchEnv;
  now?: Date;
  runDocker?: OpsWatchDockerFn;
  loadCatalog?: () => Promise<readonly CatalogProjectRef[]>;
  collectDisk?: (runDocker: OpsWatchDockerFn) => Promise<DiskSample[]>;
  send?: typeof sendOpsAlert;
};

let started = false;

export function parseOpsWatchConfig(env: OpsWatchEnv = process.env): OpsWatchConfig {
  return {
    enabled: envTruthy(env, "FLUX_OPS_WATCH_ENABLED") === true,
    intervalMs: parsePositiveInt(
      env.FLUX_OPS_WATCH_INTERVAL_MS,
      DEFAULT_OPS_WATCH_INTERVAL_MS,
    ),
    diskAlertPercent: parsePositiveInt(
      env.FLUX_OPS_WATCH_DISK_ALERT_PERCENT,
      DEFAULT_OPS_WATCH_DISK_ALERT_PERCENT,
    ),
    logMinutes: parsePositiveInt(
      env.FLUX_OPS_WATCH_LOG_MINUTES,
      DEFAULT_OPS_WATCH_LOG_MINUTES,
    ),
    logContainers: parseCsvList(
      env.FLUX_OPS_WATCH_LOG_CONTAINERS,
      [...DEFAULT_OPS_WATCH_LOG_CONTAINERS],
    ),
  };
}

export async function defaultRunDocker(args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync("docker", args, {
      maxBuffer: 8 * 1024 * 1024,
      timeout: DOCKER_TIMEOUT_MS,
    });
    // `docker logs` splits container stdout/stderr; keep both for the fatal/panic/OOM scan.
    return `${stdout.toString()}${stderr?.toString() ?? ""}`;
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & { stderr?: Buffer | string };
    const code = e?.code != null ? String(e.code) : "unknown";
    const stderr =
      typeof e.stderr === "string"
        ? e.stderr
        : e.stderr?.toString?.().trim() ?? "";
    const stderrTail = stderr ? `: ${stderr.slice(0, 800)}` : "";
    if (code === "ENOENT") {
      throw new Error("docker CLI not found on the control plane (ENOENT)");
    }
    throw new Error(`docker command failed (exit ${code})${stderrTail}`);
  }
}

export async function loadOpsWatchCatalog(): Promise<CatalogProjectRef[]> {
  await initSystemDb();
  const db = getDb();
  const rows = await db
    .select({
      slug: projects.slug,
      hash: projects.hash,
      lifecycleState: projects.lifecycleState,
      healthStatus: projects.healthStatus,
      mode: projects.mode,
    })
    .from(projects);
  return rows.map((row) => ({
    slug: row.slug,
    hash: row.hash,
    lifecycleState: row.lifecycleState,
    healthStatus: row.healthStatus,
    mode: row.mode,
  }));
}

export function parseDockerInspectPayload(raw: string): ContainerSnapshot[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const parsed: unknown = JSON.parse(trimmed);
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const out: ContainerSnapshot[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const rec = item as {
      Name?: string;
      State?: {
        Status?: string;
        Running?: boolean;
        Restarting?: boolean;
        OOMKilled?: boolean;
        ExitCode?: number;
        Error?: string;
        Health?: { Status?: string };
      };
      RestartCount?: number;
    };
    const name = normalizeContainerName(rec.Name ?? "");
    if (!name) continue;
    const state = rec.State ?? {};
    out.push({
      name,
      status: String(state.Status ?? "unknown"),
      running: state.Running === true,
      restarting: state.Restarting === true,
      oomKilled: state.OOMKilled === true,
      exitCode: typeof state.ExitCode === "number" ? state.ExitCode : 0,
      restartCount: typeof rec.RestartCount === "number" ? rec.RestartCount : 0,
      health: state.Health?.Status,
      error: state.Error || undefined,
    });
  }
  return out;
}

export async function collectHostDiskSamples(
  runDocker: OpsWatchDockerFn,
): Promise<DiskSample[]> {
  try {
    await runDocker(["rm", "-f", DISK_HELPER_NAME]);
  } catch {
    // helper may not exist
  }
  let image = "flux-web:latest";
  try {
    const inspected = (await runDocker(["inspect", "-f", "{{.Image}}", "flux-web"])).trim();
    if (inspected) image = inspected;
  } catch {
    // fall back to the stable tag
  }
  const output = await runDocker([
    "run",
    "--rm",
    `--name=${DISK_HELPER_NAME}`,
    "--network=none",
    "--read-only",
    "--user=65534:65534",
    "-v",
    "/:/host:ro",
    "--entrypoint=df",
    image,
    "-P",
  ]);
  return parsePosixDf(output, { hostPrefix: "/host" });
}

export async function collectOpsWatchFindings(
  deps: OpsWatchDeps = {},
): Promise<OpsWatchFinding[]> {
  const env = deps.env ?? process.env;
  const config = parseOpsWatchConfig(env);
  const runDocker = deps.runDocker ?? defaultRunDocker;
  const findings: OpsWatchFinding[] = [];

  let catalog: readonly CatalogProjectRef[] = [];
  try {
    catalog = deps.loadCatalog ? await deps.loadCatalog() : await loadOpsWatchCatalog();
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[flux] ops-watch: catalog lookup failed — ${detail}`);
  }

  let listed: string[] = [];
  try {
    listed = await listFluxContainerNames(runDocker);
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    findings.push({
      kind: "docker:missing",
      fingerprint: "docker:unavailable",
      message: "docker not available on this host",
      detail,
    });
    return dedupeFindings(findings);
  }
  const present = new Set(listed);
  const inspectNames = [...new Set([...listed, ...REQUIRED_CORE_CONTAINERS, ...EXPECTED_V2_CONTAINERS])];
  const snapshots = await inspectContainers(runDocker, inspectNames);
  const byName = new Map(snapshots.map((c) => [c.name, c]));

  for (const name of REQUIRED_CORE_CONTAINERS) {
    if (!byName.has(name) && !present.has(name)) {
      findings.push(missingCoreFinding(name));
    }
  }
  for (const name of EXPECTED_V2_CONTAINERS) {
    if (!byName.has(name) && !present.has(name)) {
      findings.push(missingCoreFinding(name));
    }
  }
  if (![...present].some((n) => isSystemDbContainer(n))) {
    findings.push(missingCoreFinding("flux-system-db"));
  }

  for (const snapshot of snapshots) {
    const found = classifyContainer(snapshot, catalog);
    if (found) findings.push(found);
  }

  let diskSamples: DiskSample[] = [];
  try {
    diskSamples = deps.collectDisk
      ? await deps.collectDisk(runDocker)
      : await collectHostDiskSamples(runDocker);
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[flux] ops-watch: disk check skipped — ${detail}`);
  }
  for (const sample of diskSamples) {
    const found = classifyDiskSample(sample, config.diskAlertPercent);
    if (found) findings.push(found);
  }

  for (const name of config.logContainers) {
    const snap = byName.get(name);
    if (!snap?.running) continue;
    try {
      const since = `${String(config.logMinutes)}m`;
      const logs = await runDocker(["logs", "--since", since, "--tail", "200", name]);
      findings.push(...classifyLogScan(name, logs));
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[flux] ops-watch: log scan skipped for ${name} — ${detail}`);
    }
  }

  return dedupeFindings(findings);
}

export async function runOpsWatchTick(deps: OpsWatchDeps = {}): Promise<{
  findings: OpsWatchFinding[];
  sent: number;
  deduped: number;
  failed: number;
}> {
  const env = deps.env ?? process.env;
  const config = parseOpsWatchConfig(env);
  if (!config.enabled) {
    return { findings: [], sent: 0, deduped: 0, failed: 0 };
  }

  const findings = await collectOpsWatchFindings(deps);
  if (findings.length === 0) {
    return { findings, sent: 0, deduped: 0, failed: 0 };
  }

  console.error(`[flux] ops-watch: ${String(findings.length)} finding(s)`);
  const send = deps.send ?? sendOpsAlert;
  const when = deps.now ?? new Date();
  let sent = 0;
  let deduped = 0;
  let failed = 0;
  for (const finding of findings) {
    const result = await send(
      {
        fingerprint: finding.fingerprint,
        subject: `[Flux] ops-watch: ${finding.message}`,
        body: formatOpsAlertBody({
          source: "ops-watch",
          message: finding.message,
          error: finding.detail,
          when,
        }),
      },
      { env },
    );
    if (result.status === "sent") sent += 1;
    else if (result.status === "skipped" && result.reason === "deduped") deduped += 1;
    else if (result.status === "failed") failed += 1;
  }
  return { findings, sent, deduped, failed };
}

export function startOpsWatch(): void {
  if (started) return;
  started = true;
  const config = parseOpsWatchConfig();
  if (!config.enabled) {
    console.log("[flux] ops-watch: disabled (set FLUX_OPS_WATCH_ENABLED=1 to email host/docker errors)");
    return;
  }
  const minutes = Math.round(config.intervalMs / 60_000);
  console.log(
    `[flux] ops-watch: started (${String(minutes)}m interval; error-only; disk>=${String(config.diskAlertPercent)}%)`,
  );
  void runOpsWatchTick().catch((err: unknown) => {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[flux] ops-watch: initial tick failed — ${detail}`);
  });
  setInterval(() => {
    void runOpsWatchTick().catch((err: unknown) => {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[flux] ops-watch: tick failed — ${detail}`);
    });
  }, config.intervalMs);
}

export function resetOpsWatchStartedForTests(): void {
  started = false;
}

async function listFluxContainerNames(runDocker: OpsWatchDockerFn): Promise<string[]> {
  const raw = await runDocker(["ps", "-a", "--format", "{{.Names}}"]);
  return raw
    .split(/\r?\n/)
    .map((n) => normalizeContainerName(n))
    .filter((n) => n.length > 0 && isFluxNamedContainer(n) && !isIgnoredOpsWatchContainer(n));
}

async function inspectContainers(
  runDocker: OpsWatchDockerFn,
  names: string[],
): Promise<ContainerSnapshot[]> {
  const unique = [...new Set(names.map(normalizeContainerName))].filter(Boolean);
  if (unique.length === 0) return [];
  try {
    const raw = await runDocker(["inspect", ...unique]);
    return parseDockerInspectPayload(raw).filter(
      (c) => isFluxNamedContainer(c.name) && !isIgnoredOpsWatchContainer(c.name),
    );
  } catch {
    const found: ContainerSnapshot[] = [];
    for (const name of unique) {
      try {
        const raw = await runDocker(["inspect", name]);
        found.push(...parseDockerInspectPayload(raw));
      } catch {
        // missing — handled by required/expected loops
      }
    }
    return found.filter(
      (c) => isFluxNamedContainer(c.name) && !isIgnoredOpsWatchContainer(c.name),
    );
  }
}

function dedupeFindings(findings: OpsWatchFinding[]): OpsWatchFinding[] {
  const seen = new Set<string>();
  const out: OpsWatchFinding[] = [];
  for (const finding of findings) {
    if (seen.has(finding.fingerprint)) continue;
    seen.add(finding.fingerprint);
    out.push(finding);
  }
  return out;
}

function envTruthy(env: OpsWatchEnv, name: string): boolean | undefined {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return undefined;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseCsvList(raw: string | undefined, fallback: string[]): string[] {
  if (!raw?.trim()) return fallback;
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}
