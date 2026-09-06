/**
 * Pure classifiers for the error-only host/Docker watcher.
 * Keep skip rules aligned with `bin/ops-watch.sh`.
 */

export const DEFAULT_OPS_WATCH_INTERVAL_MS = 15 * 60 * 1000;
export const DEFAULT_OPS_WATCH_DISK_ALERT_PERCENT = 90;
export const DEFAULT_OPS_WATCH_LOG_MINUTES = 15;
/** Hard cap for `docker logs` so noisy json-file tails cannot SIGTERM the tick. */
export const DEFAULT_OPS_WATCH_LOG_TIMEOUT_MS = 8_000;
export const DEFAULT_OPS_WATCH_LOG_TAIL = 80;
/**
 * Host paths sampled from a `/` bind at `/host`. Never run bare `df -P`
 * (that walks `/host/run/docker/netns/*` and Permission-denies).
 */
export const HOST_DF_SHELL =
  'for p in /host /host/srv /host/var/lib/docker; do [ -e "$p" ] && df -P "$p" || true; done';
export const DEFAULT_OPS_WATCH_LOG_CONTAINERS = [
  "flux-web",
  "flux-gateway",
  "flux-node-gateway",
  "flux-postgres-v2",
] as const;

export const REQUIRED_CORE_CONTAINERS = [
  "flux-web",
  "flux-gateway",
  "flux-node-gateway",
] as const;

export const EXPECTED_V2_CONTAINERS = [
  "flux-postgres-v2",
  "flux-pgbouncer",
  "flux-postgrest-pool",
] as const;

const TENANT_NAME_RE = /^flux-([0-9a-f]{7})-(.+)$/;
const SYSTEM_DB_SUFFIX = "flux-system-db";

const LOG_MATCHERS: ReadonlyArray<{ key: "fatal" | "panic" | "oom"; re: RegExp }> = [
  { key: "oom", re: /\b(oom[- ]?(killed|killer)?|out of memory)\b/i },
  { key: "fatal", re: /\bfatal\b/i },
  { key: "panic", re: /\bpanic(?:ked)?\b/i },
];

export type OpsWatchFindingKind =
  | "docker:missing"
  | "docker:exited"
  | "docker:unhealthy"
  | "docker:restarting"
  | "disk"
  | "log";

export type OpsWatchFinding = {
  kind: OpsWatchFindingKind;
  fingerprint: string;
  message: string;
  detail: string;
};

export type CatalogProjectRef = {
  slug: string;
  hash: string;
  lifecycleState: string | null;
  healthStatus: string | null;
  mode?: string | null;
};

export type ContainerSnapshot = {
  name: string;
  status: string;
  running: boolean;
  restarting: boolean;
  oomKilled: boolean;
  exitCode: number;
  restartCount: number;
  health?: string;
  error?: string;
};

export type DiskSample = {
  filesystem: string;
  percent: number;
  mount: string;
  label: "root" | "srv" | "docker";
};

export function normalizeContainerName(name: string): string {
  return name.replace(/^\//, "").trim();
}

export function isIgnoredOpsWatchContainer(name: string): boolean {
  const n = normalizeContainerName(name);
  if (n.startsWith("flux-backup-verify-")) return true;
  if (n.startsWith("flux-ops-watch-")) return true;
  if (n.endsWith("-canary")) return true;
  return false;
}

export function isFluxNamedContainer(name: string): boolean {
  return normalizeContainerName(name).startsWith("flux-");
}

export function isRequiredCoreContainer(name: string): boolean {
  return (REQUIRED_CORE_CONTAINERS as readonly string[]).includes(
    normalizeContainerName(name),
  );
}

export function isExpectedV2Container(name: string): boolean {
  return (EXPECTED_V2_CONTAINERS as readonly string[]).includes(
    normalizeContainerName(name),
  );
}

export function isSystemDbContainer(name: string): boolean {
  return normalizeContainerName(name).endsWith(SYSTEM_DB_SUFFIX);
}

export function parseTenantHash(name: string): string | null {
  const n = normalizeContainerName(name);
  if (isRequiredCoreContainer(n) || isExpectedV2Container(n) || isSystemDbContainer(n)) {
    return null;
  }
  const m = TENANT_NAME_RE.exec(n);
  return m?.[1] ?? null;
}

export function isFluxTenantContainer(name: string): boolean {
  return parseTenantHash(name) != null;
}

/**
 * Intentionally stopped / leftover exited tenants are not emailed.
 *
 * Skip when:
 * - name is a disposable helper (`flux-backup-verify-*`, `flux-ops-watch-*`, `*-canary`)
 * - name is not a well-formed `flux-<7hex>-*` tenant stack
 * - no catalog row for that hash (orphan / leftover test — same as ops-audit WARN)
 * - catalog `lifecycle_state` is `dormant` or `archived` (sleep/archive)
 * - catalog `health_status` is `stopped` (dashboard power-off / `flux reap`)
 *
 * Restarting / unhealthy still alert even for those rows.
 */
export function shouldSkipExitedTenant(
  name: string,
  catalog: readonly CatalogProjectRef[],
): boolean {
  if (isIgnoredOpsWatchContainer(name)) return true;
  const hash = parseTenantHash(name);
  if (!hash) return true;
  const row = catalog.find((p) => p.hash === hash);
  if (!row) return true;
  const lifecycle = (row.lifecycleState ?? "").trim().toLowerCase();
  if (lifecycle === "dormant" || lifecycle === "archived") return true;
  const health = (row.healthStatus ?? "").trim().toLowerCase();
  if (health === "stopped") return true;
  return false;
}

export function classifyContainer(
  container: ContainerSnapshot,
  catalog: readonly CatalogProjectRef[],
): OpsWatchFinding | null {
  const name = normalizeContainerName(container.name);
  if (!isFluxNamedContainer(name) || isIgnoredOpsWatchContainer(name)) {
    return null;
  }

  if (container.restarting || container.status === "restarting") {
    return finding(
      "docker:restarting",
      `docker:restarting:${name}`,
      `${name} is restarting`,
      statusDetail(container),
    );
  }

  const health = (container.health ?? "").toLowerCase();
  if (health === "unhealthy") {
    return finding(
      "docker:unhealthy",
      `docker:unhealthy:${name}`,
      `${name} is unhealthy`,
      statusDetail(container),
    );
  }

  const notRunning =
    !container.running &&
    (container.status === "exited" ||
      container.status === "dead" ||
      container.status === "created" ||
      container.status === "paused" ||
      container.status === "removing" ||
      container.status === "stopped");

  if (!notRunning) return null;

  if (isFluxTenantContainer(name) && shouldSkipExitedTenant(name, catalog)) {
    return null;
  }

  return finding(
    "docker:exited",
    `docker:exited:${name}`,
    `${name} is not running (status=${container.status})`,
    statusDetail(container),
  );
}

export function missingCoreFinding(name: string): OpsWatchFinding {
  const n = normalizeContainerName(name);
  return finding(
    "docker:missing",
    `docker:missing:${n}`,
    `${n} is missing`,
    "docker inspect returned no such container",
  );
}

export function classifyDiskSample(
  sample: DiskSample,
  alertPercent: number,
): OpsWatchFinding | null {
  if (sample.percent < alertPercent) return null;
  return finding(
    "disk",
    `disk:${sample.label}:${sample.percent}`,
    `${sample.label} filesystem is ${String(sample.percent)}% full`,
    `${sample.mount} on ${sample.filesystem} >= ${String(alertPercent)}%`,
  );
}

export function matchOpsWatchLogLine(
  line: string,
): "fatal" | "panic" | "oom" | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  for (const matcher of LOG_MATCHERS) {
    if (matcher.re.test(trimmed)) return matcher.key;
  }
  return null;
}

export function classifyLogScan(
  containerName: string,
  logs: string,
): OpsWatchFinding[] {
  const name = normalizeContainerName(containerName);
  const seen = new Set<string>();
  const findings: OpsWatchFinding[] = [];
  for (const line of logs.split(/\r?\n/)) {
    const key = matchOpsWatchLogLine(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const excerpt = line.trim().slice(0, 240);
    findings.push(
      finding(
        "log",
        `log:${key}:${name}`,
        `${name} log matched ${key}`,
        excerpt,
      ),
    );
  }
  return findings;
}

export function parsePosixDf(
  output: string,
  options?: { hostPrefix?: string },
): DiskSample[] {
  const hostPrefix = options?.hostPrefix ?? "";
  const samples: DiskSample[] = [];
  const seen = new Set<string>();
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^Filesystem\b/i.test(line)) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 6) continue;
    const filesystem = parts[0]!;
    const capacity = parts[4]!;
    const mount = parts.slice(5).join(" ");
    const percent = Number.parseInt(capacity.replace(/%/g, ""), 10);
    if (!Number.isFinite(percent)) continue;
    const mapped = mapDiskMount(mount, hostPrefix);
    if (!mapped) continue;
    const key = `${filesystem}\0${mapped.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    samples.push({
      filesystem,
      percent,
      mount: mapped.path,
      label: mapped.label,
    });
  }
  return samples;
}

export function mapDiskMount(
  mount: string,
  hostPrefix: string,
): { label: DiskSample["label"]; path: string } | null {
  let path = mount;
  if (hostPrefix) {
    if (mount !== hostPrefix && !mount.startsWith(`${hostPrefix}/`)) {
      return null;
    }
    path = mount.slice(hostPrefix.length) || "/";
  }
  if (path === "/" || path === "") return { label: "root", path: "/" };
  if (path === "/srv" || path.startsWith("/srv/")) return { label: "srv", path: "/srv" };
  if (path === "/var/lib/docker" || path.startsWith("/var/lib/docker/")) {
    return { label: "docker", path: "/var/lib/docker" };
  }
  return null;
}

function statusDetail(container: ContainerSnapshot): string {
  const bits = [
    `status=${container.status}`,
    `exit=${String(container.exitCode)}`,
    `restarts=${String(container.restartCount)}`,
  ];
  if (container.health) bits.push(`health=${container.health}`);
  if (container.oomKilled) bits.push("oomKilled");
  if (container.error) bits.push(container.error);
  return bits.join(" ");
}

function finding(
  kind: OpsWatchFindingKind,
  fingerprint: string,
  message: string,
  detail: string,
): OpsWatchFinding {
  return { kind, fingerprint, message, detail };
}
