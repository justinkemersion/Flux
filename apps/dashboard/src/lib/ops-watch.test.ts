import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resetOpsAlertStateForTests,
  setOpsAlertTestHooks,
  type OpsAlertTransport,
} from "./ops-alert-email.ts";
import {
  classifyContainer,
  classifyDiskSample,
  classifyLogScan,
  HOST_DF_SHELL,
  isIgnoredOpsWatchContainer,
  mapDiskMount,
  matchOpsWatchLogLine,
  missingCoreFinding,
  parsePosixDf,
  parseTenantHash,
  shouldSkipExitedTenant,
  type CatalogProjectRef,
  type ContainerSnapshot,
} from "./ops-watch-classify.ts";
import {
  collectHostDiskSamples,
  collectOpsWatchFindings,
  isOpsWatchToolingSkip,
  OpsWatchDockerError,
  parseDockerInspectPayload,
  parseOpsWatchConfig,
  resetOpsWatchStartedForTests,
  runOpsWatchTick,
} from "./ops-watch.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const ACTIVE: CatalogProjectRef = {
  slug: "shop",
  hash: "abc1234",
  lifecycleState: "active",
  healthStatus: "running",
};

function container(partial: Partial<ContainerSnapshot> & { name: string }): ContainerSnapshot {
  return {
    status: "running",
    running: true,
    restarting: false,
    oomKilled: false,
    exitCode: 0,
    restartCount: 0,
    ...partial,
  };
}

function mockTransport(): OpsAlertTransport & {
  sent: Array<{ subject: string; text: string }>;
} {
  const sent: Array<{ subject: string; text: string }> = [];
  return {
    sent,
    async send(mail) {
      sent.push({ subject: mail.subject, text: mail.text });
    },
  };
}

test("parseOpsWatchConfig is off by default and reads knobs", () => {
  assert.equal(parseOpsWatchConfig({}).enabled, false);
  const cfg = parseOpsWatchConfig({
    FLUX_OPS_WATCH_ENABLED: "1",
    FLUX_OPS_WATCH_INTERVAL_MS: "600000",
    FLUX_OPS_WATCH_DISK_ALERT_PERCENT: "92",
    FLUX_OPS_WATCH_LOG_MINUTES: "20",
    FLUX_OPS_WATCH_LOG_TIMEOUT_MS: "5000",
    FLUX_OPS_WATCH_LOG_TAIL: "40",
    FLUX_OPS_WATCH_LOG_CONTAINERS: "flux-web,flux-gateway",
  });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.intervalMs, 600_000);
  assert.equal(cfg.diskAlertPercent, 92);
  assert.equal(cfg.logMinutes, 20);
  assert.equal(cfg.logTimeoutMs, 5_000);
  assert.equal(cfg.logTail, 40);
  assert.deepEqual(cfg.logContainers, ["flux-web", "flux-gateway"]);
});

test("ignored containers include verify helpers and canaries", () => {
  assert.equal(isIgnoredOpsWatchContainer("flux-backup-verify-abc"), true);
  assert.equal(isIgnoredOpsWatchContainer("flux-ops-watch-df"), true);
  assert.equal(isIgnoredOpsWatchContainer("flux-node-gateway-canary"), true);
  assert.equal(isIgnoredOpsWatchContainer("flux-web"), false);
});

test("parseTenantHash reads flux-<7hex>- stacks and skips core names", () => {
  assert.equal(parseTenantHash("flux-abc1234-shop-db"), "abc1234");
  assert.equal(parseTenantHash("flux-web"), null);
  assert.equal(parseTenantHash("flux-postgres-v2"), null);
  assert.equal(parseTenantHash("flux-a1b2c3d-flux-system-db"), null);
});

test("shouldSkipExitedTenant documents intentional stops", () => {
  assert.equal(shouldSkipExitedTenant("flux-abc1234-shop-db", [ACTIVE]), false);
  assert.equal(
    shouldSkipExitedTenant("flux-abc1234-shop-db", [
      { ...ACTIVE, lifecycleState: "archived" },
    ]),
    true,
  );
  assert.equal(
    shouldSkipExitedTenant("flux-abc1234-shop-db", [
      { ...ACTIVE, lifecycleState: "dormant" },
    ]),
    true,
  );
  assert.equal(
    shouldSkipExitedTenant("flux-abc1234-shop-db", [
      { ...ACTIVE, healthStatus: "stopped" },
    ]),
    true,
  );
  assert.equal(shouldSkipExitedTenant("flux-abc1234-shop-db", []), true);
  assert.equal(shouldSkipExitedTenant("flux-backup-verify-x", [ACTIVE]), true);
});

test("classifyContainer alerts restarting, unhealthy, and unexpected exits", () => {
  assert.equal(
    classifyContainer(container({ name: "nginx", status: "exited", running: false }), []),
    null,
  );

  const restarting = classifyContainer(
    container({ name: "flux-web", status: "restarting", running: false, restarting: true }),
    [],
  );
  assert.equal(restarting?.fingerprint, "docker:restarting:flux-web");

  const unhealthy = classifyContainer(
    container({ name: "flux-postgres-v2", health: "unhealthy" }),
    [],
  );
  assert.equal(unhealthy?.fingerprint, "docker:unhealthy:flux-postgres-v2");

  const coreExit = classifyContainer(
    container({ name: "flux-gateway", status: "exited", running: false, exitCode: 1 }),
    [],
  );
  assert.equal(coreExit?.fingerprint, "docker:exited:flux-gateway");

  const archivedExit = classifyContainer(
    container({ name: "flux-abc1234-shop-db", status: "exited", running: false }),
    [{ ...ACTIVE, lifecycleState: "archived" }],
  );
  assert.equal(archivedExit, null);

  const activeCrash = classifyContainer(
    container({
      name: "flux-abc1234-shop-api",
      status: "exited",
      running: false,
      exitCode: 1,
    }),
    [ACTIVE],
  );
  assert.equal(activeCrash?.fingerprint, "docker:exited:flux-abc1234-shop-api");

  const healthy = classifyContainer(container({ name: "flux-web" }), []);
  assert.equal(healthy, null);
});

test("missingCoreFinding uses docker:missing fingerprint", () => {
  assert.equal(missingCoreFinding("flux-node-gateway").fingerprint, "docker:missing:flux-node-gateway");
});

test("disk classifier matches ops-audit 90% alert and fingerprints percent", () => {
  assert.equal(
    classifyDiskSample(
      { filesystem: "/dev/sda1", percent: 89, mount: "/", label: "root" },
      90,
    ),
    null,
  );
  const alert = classifyDiskSample(
    { filesystem: "/dev/sda1", percent: 94, mount: "/", label: "root" },
    90,
  );
  assert.equal(alert?.fingerprint, "disk:root:94");
});

test("parsePosixDf maps host-prefix mounts and skips container overlay", () => {
  const samples = parsePosixDf(
    [
      "Filesystem     1024-blocks      Used Available Capacity Mounted on",
      "overlay            1000000    200000    800000      20% /",
      "/dev/sda1        200000000 188000000  12000000      94% /host",
      "/dev/sda1        200000000 188000000  12000000      94% /host/srv",
      "/dev/sdb1         50000000  46000000   4000000      91% /host/var/lib/docker",
    ].join("\n"),
    { hostPrefix: "/host" },
  );
  assert.deepEqual(
    samples.map((s) => `${s.label}:${s.percent}:${s.mount}`),
    ["root:94:/", "srv:94:/srv", "docker:91:/var/lib/docker"],
  );
  assert.equal(mapDiskMount("/", "/host"), null);
  assert.deepEqual(mapDiskMount("/host/srv", "/host"), { label: "srv", path: "/srv" });
});

test("log scan matches fatal/panic/oom only once per key and ignores stderr noise", () => {
  assert.equal(matchOpsWatchLogLine("GET /health 200"), null);
  assert.equal(matchOpsWatchLogLine("level=error msg=timeout"), null);
  assert.equal(matchOpsWatchLogLine("fatal: password authentication failed"), "fatal");
  assert.equal(matchOpsWatchLogLine("thread panicked at src/main.rs"), "panic");
  assert.equal(matchOpsWatchLogLine("postgres was oom-killed"), "oom");
  assert.equal(matchOpsWatchLogLine("Out of memory: Kill process 12"), "oom");

  const findings = classifyLogScan(
    "flux-web",
    [
      "info started",
      "fatal: cannot bind",
      "fatal: still cannot bind",
      "panic: invariant",
    ].join("\n"),
  );
  assert.deepEqual(
    findings.map((f) => f.fingerprint),
    ["log:fatal:flux-web", "log:panic:flux-web"],
  );
});

test("parseDockerInspectPayload reads Engine inspect JSON", () => {
  const snapshots = parseDockerInspectPayload(
    JSON.stringify([
      {
        Name: "/flux-web",
        RestartCount: 2,
        State: {
          Status: "running",
          Running: true,
          Restarting: false,
          OOMKilled: false,
          ExitCode: 0,
          Health: { Status: "healthy" },
        },
      },
    ]),
  );
  assert.equal(snapshots[0]?.name, "flux-web");
  assert.equal(snapshots[0]?.health, "healthy");
  assert.equal(snapshots[0]?.restartCount, 2);
});

test("collectOpsWatchFindings is quiet when the fleet is healthy", async () => {
  const inspect = [
    inspectJson("flux-web", { status: "running", running: true }),
    inspectJson("flux-gateway", { status: "running", running: true }),
    inspectJson("flux-node-gateway", { status: "running", running: true }),
    inspectJson("flux-postgres-v2", { status: "running", running: true, health: "healthy" }),
    inspectJson("flux-pgbouncer", { status: "running", running: true }),
    inspectJson("flux-postgrest-pool", { status: "running", running: true }),
    inspectJson("flux-aabbccd-flux-system-db", { status: "running", running: true }),
    inspectJson("flux-abc1234-shop-db", { status: "exited", running: false }),
  ];
  const findings = await collectOpsWatchFindings({
    env: { FLUX_OPS_WATCH_ENABLED: "1" },
    loadCatalog: async () => [{ ...ACTIVE, lifecycleState: "archived" }],
    collectDisk: async () => [
      { filesystem: "/dev/sda1", percent: 71, mount: "/", label: "root" },
    ],
    runDocker: async (args) => {
      if (args[0] === "ps") {
        return inspect.map((c) => c.Name.replace(/^\//, "")).join("\n");
      }
      if (args[0] === "inspect") {
        const wanted = new Set(args.slice(1));
        return JSON.stringify(inspect.filter((c) => wanted.has(c.Name.replace(/^\//, ""))));
      }
      if (args[0] === "logs") return "ready\n";
      throw new Error(`unexpected docker ${args.join(" ")}`);
    },
  });
  assert.deepEqual(findings, []);
});

test("collectOpsWatchFindings reports missing core, disk, and unexpected tenant exit", async () => {
  const inspect = [
    inspectJson("flux-web", { status: "running", running: true }),
    inspectJson("flux-gateway", { status: "exited", running: false, exitCode: 2 }),
    inspectJson("flux-abc1234-shop-api", { status: "exited", running: false, exitCode: 1 }),
  ];
  const findings = await collectOpsWatchFindings({
    env: {
      FLUX_OPS_WATCH_ENABLED: "1",
      FLUX_OPS_WATCH_DISK_ALERT_PERCENT: "90",
    },
    loadCatalog: async () => [ACTIVE],
    collectDisk: async () => [
      { filesystem: "/dev/sda1", percent: 94, mount: "/", label: "root" },
    ],
    runDocker: async (args) => {
      if (args[0] === "ps") {
        return "flux-web\nflux-gateway\nflux-abc1234-shop-api\n";
      }
      if (args[0] === "inspect") {
        return JSON.stringify(inspect);
      }
      if (args[0] === "logs") return "";
      throw new Error(`unexpected docker ${args.join(" ")}`);
    },
  });
  const fps = findings.map((f) => f.fingerprint).sort();
  assert.ok(fps.includes("docker:exited:flux-gateway"));
  assert.ok(fps.includes("docker:missing:flux-node-gateway"));
  assert.ok(fps.includes("docker:missing:flux-postgres-v2"));
  assert.ok(fps.includes("docker:exited:flux-abc1234-shop-api"));
  assert.ok(fps.includes("disk:root:94"));
});

test("runOpsWatchTick stays silent when disabled and emails findings when enabled", async () => {
  resetOpsAlertStateForTests();
  resetOpsWatchStartedForTests();
  const transport = mockTransport();
  setOpsAlertTestHooks({ transport });

  const disabled = await runOpsWatchTick({
    env: {},
    loadCatalog: async () => [],
    collectDisk: async () => [],
    runDocker: async () => {
      throw new Error("docker should not run when disabled");
    },
  });
  assert.deepEqual(disabled.findings, []);
  assert.equal(transport.sent.length, 0);

  const inspect = [inspectJson("flux-web", { status: "restarting", running: false, restarting: true })];
  const env = {
    FLUX_OPS_WATCH_ENABLED: "1",
    FLUX_ALERT_EMAIL_TO: "justin@vsl-base.com",
    FLUX_RESEND_API_KEY: "re_test",
  };
  const first = await runOpsWatchTick({
    env,
    now: new Date("2026-09-06T12:00:00.000Z"),
    loadCatalog: async () => [],
    collectDisk: async () => [],
    runDocker: async (args) => {
      if (args[0] === "ps") return "flux-web\n";
      if (args[0] === "inspect") return JSON.stringify(inspect);
      if (args[0] === "logs") return "";
      return "";
    },
  });
  assert.ok(first.findings.some((f) => f.fingerprint === "docker:restarting:flux-web"));
  assert.equal(first.sent, first.findings.length);
  assert.equal(transport.sent.length, first.findings.length);
  assert.match(transport.sent[0]!.subject, /ops-watch/);
  assert.match(transport.sent[0]!.text, /source: ops-watch/);

  const again = await runOpsWatchTick({
    env,
    now: new Date("2026-09-06T12:00:00.000Z"),
    loadCatalog: async () => [],
    collectDisk: async () => [],
    runDocker: async (args) => {
      if (args[0] === "ps") return "flux-web\n";
      if (args[0] === "inspect") return JSON.stringify(inspect);
      if (args[0] === "logs") return "";
      return "";
    },
  });
  assert.equal(again.deduped, again.findings.length);
  assert.equal(transport.sent.length, first.findings.length);

  resetOpsAlertStateForTests();
});

test("HOST_DF_SHELL only dfs explicit host bind paths", () => {
  assert.match(HOST_DF_SHELL, /df -P "\$p"/);
  assert.match(HOST_DF_SHELL, /\/host\/srv/);
  assert.match(HOST_DF_SHELL, /\/host\/var\/lib\/docker/);
  assert.doesNotMatch(HOST_DF_SHELL, /df -P"/);
  assert.doesNotMatch(HOST_DF_SHELL, /netns/);
});

test("collectHostDiskSamples dfs specific /host paths and recovers netns Permission denied stdout", async () => {
  const dfOut = [
    "Filesystem     1024-blocks      Used Available Capacity Mounted on",
    "/dev/sda1        200000000 188000000  12000000      94% /host",
  ].join("\n");
  const calls: string[][] = [];
  const samples = await collectHostDiskSamples(async (args) => {
    calls.push(args);
    if (args[0] === "rm") return "";
    if (args[0] === "inspect") return "sha256:abc\n";
    if (args[0] === "run") {
      assert.equal(args.includes("--entrypoint=df"), false);
      assert.equal(args.includes("-P") && args.at(-1) === "-P", false);
      assert.ok(args.includes("--entrypoint=sh"));
      assert.equal(args.at(-1), HOST_DF_SHELL);
      throw new OpsWatchDockerError(
        "docker command failed (exit 1): df: /host/run/docker/netns/default: Permission denied",
        { code: "1", stdout: dfOut, stderr: "df: /host/run/docker/netns/default: Permission denied" },
      );
    }
    throw new Error(`unexpected docker ${args.join(" ")}`);
  });
  assert.deepEqual(
    samples.map((s) => `${s.label}:${s.percent}`),
    ["root:94"],
  );
  assert.ok(calls.some((a) => a[0] === "run"));
});

test("isOpsWatchToolingSkip treats SIGTERM / 143 as a skip", () => {
  assert.equal(
    isOpsWatchToolingSkip(
      new OpsWatchDockerError("docker command failed (exit 143)", {
        code: "143",
        stdout: "",
        stderr: "",
        signal: "SIGTERM",
      }),
    ),
    true,
  );
  assert.equal(isOpsWatchToolingSkip(new Error("docker command failed (exit 143)")), true);
  assert.equal(isOpsWatchToolingSkip(new Error("disk is 94% full")), false);
});

test("collectOpsWatchFindings does not page on disk or log tooling skips", async () => {
  const inspect = [
    inspectJson("flux-web", { status: "running", running: true }),
    inspectJson("flux-gateway", { status: "running", running: true }),
    inspectJson("flux-node-gateway", { status: "running", running: true }),
    inspectJson("flux-postgres-v2", { status: "running", running: true, health: "healthy" }),
    inspectJson("flux-pgbouncer", { status: "running", running: true }),
    inspectJson("flux-postgrest-pool", { status: "running", running: true }),
    inspectJson("flux-aabbccd-flux-system-db", { status: "running", running: true }),
  ];
  const findings = await collectOpsWatchFindings({
    env: {
      FLUX_OPS_WATCH_ENABLED: "1",
      FLUX_OPS_WATCH_LOG_CONTAINERS: "flux-postgres-v2",
    },
    loadCatalog: async () => [],
    collectDisk: async () => {
      throw new OpsWatchDockerError(
        "docker command failed (exit 1): df: /host/run/docker/netns/default: Permission denied",
        { code: "1", stdout: "", stderr: "Permission denied" },
      );
    },
    runDocker: async (args, options) => {
      if (args[0] === "ps") {
        return inspect.map((c) => c.Name.replace(/^\//, "")).join("\n");
      }
      if (args[0] === "inspect") return JSON.stringify(inspect);
      if (args[0] === "logs") {
        assert.ok((options?.timeoutMs ?? 0) > 0);
        assert.ok((options?.timeoutMs ?? 0) <= 15_000);
        throw new OpsWatchDockerError("docker command failed (exit 143)", {
          code: "143",
          stdout: "",
          stderr: "",
          signal: "SIGTERM",
        });
      }
      throw new Error(`unexpected docker ${args.join(" ")}`);
    },
  });
  assert.deepEqual(findings, []);
});

test("collectOpsWatchFindings still pages matched fatal lines after a successful log read", async () => {
  const inspect = [
    inspectJson("flux-web", { status: "running", running: true }),
    inspectJson("flux-gateway", { status: "running", running: true }),
    inspectJson("flux-node-gateway", { status: "running", running: true }),
    inspectJson("flux-postgres-v2", { status: "running", running: true, health: "healthy" }),
    inspectJson("flux-pgbouncer", { status: "running", running: true }),
    inspectJson("flux-postgrest-pool", { status: "running", running: true }),
    inspectJson("flux-aabbccd-flux-system-db", { status: "running", running: true }),
  ];
  const findings = await collectOpsWatchFindings({
    env: {
      FLUX_OPS_WATCH_ENABLED: "1",
      FLUX_OPS_WATCH_LOG_CONTAINERS: "flux-web",
    },
    loadCatalog: async () => [],
    collectDisk: async () => [],
    runDocker: async (args) => {
      if (args[0] === "ps") {
        return inspect.map((c) => c.Name.replace(/^\//, "")).join("\n");
      }
      if (args[0] === "inspect") return JSON.stringify(inspect);
      if (args[0] === "logs") return "fatal: cannot bind 3000\n";
      throw new Error(`unexpected docker ${args.join(" ")}`);
    },
  });
  assert.deepEqual(
    findings.map((f) => f.fingerprint),
    ["log:fatal:flux-web"],
  );
});

test("bin/ops-watch.sh stays error-only and documents the exited-tenant filter", () => {
  const script = readFileSync(join(REPO_ROOT, "bin", "ops-watch.sh"), "utf8");
  assert.match(script, /error-only/i);
  assert.match(script, /lifecycle_state/);
  assert.match(script, /health_status/);
  assert.match(script, /flux-backup-verify-/);
  assert.match(script, /--remote/);
  assert.match(script, /FLUX_OPS_WATCH_DISK_ALERT_PERCENT/);
  assert.doesNotMatch(script, /api\.resend\.com/);
});

function inspectJson(
  name: string,
  state: {
    status: string;
    running: boolean;
    restarting?: boolean;
    exitCode?: number;
    health?: string;
  },
) {
  return {
    Name: `/${name}`,
    RestartCount: 0,
    State: {
      Status: state.status,
      Running: state.running,
      Restarting: state.restarting === true,
      OOMKilled: false,
      ExitCode: state.exitCode ?? 0,
      Health: state.health ? { Status: state.health } : undefined,
    },
  };
}
