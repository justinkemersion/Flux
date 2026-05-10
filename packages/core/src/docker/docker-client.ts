import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import Docker from "dockerode";

/**
 * Options for constructing a Dockerode client used by the Flux control plane (`ProjectManager` and CLI).
 *
 * **Precedence:** Injected {@link ProjectManagerConnectOptions.docker} wins; else if
 * {@link ProjectManagerConnectOptions.host} is set, a client is built for that remote endpoint; else
 * {@link createFluxDocker} uses `new Docker()`, which applies **`DOCKER_HOST`** (including
 * `unix://`, `tcp://`, TLS env vars, and **`ssh://user@host`** via docker-modem + ssh2) the same way
 * as the Docker CLI.
 */
export interface ProjectManagerConnectOptions {
  /** Use a pre-configured client (tests, custom modem options). */
  docker?: Docker;
  /** Remote Engine hostname or IP (not a `ssh://` URL — use {@link protocol} `ssh` instead). */
  host?: string;
  /** Engine API port; defaults by protocol: HTTP `2375`, HTTPS `2376`, SSH `22`. */
  port?: number | string;
  /** When omitted with a TCP {@link host}, defaults to `http`. */
  protocol?: "http" | "https" | "ssh";
  /** SSH login when {@link protocol} is `ssh` (docker-modem `username`). */
  username?: string;
  /**
   * Extra ssh2 connect options merged with modem defaults (`SSH_AUTH_SOCK` agent when set).
   * See ssh2 `ConnectConfig` — common keys include `agent`, `privateKey`, `tryKeyboard`, etc.
   * For file-based keys without an agent, **`FLUX_DOCKER_SSH_IDENTITY`** is also supported.
   */
  sshOptions?: Record<string, unknown>;
}

function assertNoRemoteFieldsWithoutHost(opts: ProjectManagerConnectOptions): void {
  const hasHost = opts.host != null && String(opts.host).trim() !== "";
  if (hasHost) return;
  if (
    opts.port != null ||
    opts.protocol != null ||
    opts.username != null ||
    opts.sshOptions != null
  ) {
    throw new TypeError(
      "ProjectManagerConnectOptions: `host` is required when `port`, `protocol`, `username`, or `sshOptions` is set",
    );
  }
}

function defaultSshAgentOptions(): Record<string, unknown> {
  const agent = process.env.SSH_AUTH_SOCK;
  return agent ? { agent } : {};
}

function expandUserPath(p: string): string {
  if (p === "~" || p.startsWith("~/")) {
    return path.join(homedir(), p === "~" ? "" : p.slice(2));
  }
  return p;
}

/**
 * Loads a private key file for Docker-over-SSH when **no ssh-agent** is in use.
 *
 * If **`SSH_AUTH_SOCK`** is set, returns nothing so **ssh-agent** (e.g. after `ssh-add`) is used
 * alone — avoids ssh2 trying to parse an **encrypted** `~/.ssh/id_ed25519` while your real identity
 * lives in the agent.
 *
 * Otherwise: **`FLUX_DOCKER_SSH_IDENTITY`** (path, `~` allowed) if set, else `~/.ssh/id_ed25519`.
 */
function maybeAutoSshPrivateKeyFileOption(): { privateKey: Buffer } | Record<string, never> {
  if (process.env.SSH_AUTH_SOCK?.trim()) {
    return {};
  }
  try {
    const raw = process.env.FLUX_DOCKER_SSH_IDENTITY?.trim();
    const keyPath = raw
      ? expandUserPath(raw)
      : path.join(homedir(), ".ssh", "id_ed25519");
    if (!existsSync(keyPath)) return {};
    return { privateKey: readFileSync(keyPath) };
  } catch {
    return {};
  }
}

/** Default ssh2 keepalive so idle SSH (e.g. Hetzner) does not drop between docker execs. Tighter than 10s. */
const FLUX_SSH_KEEPALIVE_INTERVAL_MS = 5_000;

function mergeSshOptionsForSshProtocol(user?: Record<string, unknown>): Record<string, unknown> {
  const keepaliveBase = { keepaliveInterval: FLUX_SSH_KEEPALIVE_INTERVAL_MS };
  const agentPart = defaultSshAgentOptions();
  const keyPart =
    user?.privateKey !== undefined ? {} : maybeAutoSshPrivateKeyFileOption();
  return { ...keepaliveBase, ...agentPart, ...keyPart, ...user };
}

/** Ensures Docker-over-SSH clients send periodic channel keepalives (ssh2 `keepaliveInterval`). */
function applySshEngineKeepalives(docker: Docker): void {
  const m = docker.modem as {
    protocol?: string;
    sshOptions?: Record<string, unknown>;
  };
  if (m.protocol !== "ssh") return;
  const cur = m.sshOptions ?? {};
  if (cur.keepaliveInterval !== undefined && cur.keepaliveInterval !== null) {
    return;
  }
  m.sshOptions = { ...cur, keepaliveInterval: FLUX_SSH_KEEPALIVE_INTERVAL_MS };
}

/**
 * If this client uses SSH to reach the Engine and no `privateKey` was configured, may merge a
 * key file — skipped when an **agent** is already configured or **`SSH_AUTH_SOCK`** is set (see
 * {@link maybeAutoSshPrivateKeyFileOption}).
 */
function augmentDockerSshClientIfNeeded(docker: Docker): void {
  const m = docker.modem as {
    protocol?: string;
    sshOptions?: Record<string, unknown>;
  };
  if (m.protocol !== "ssh") return;
  const cur = m.sshOptions ?? {};
  if (cur.privateKey !== undefined) return;
  if (cur.agent != null && String(cur.agent).length > 0) return;
  const extra = maybeAutoSshPrivateKeyFileOption();
  if (!("privateKey" in extra)) return;
  m.sshOptions = mergeSshOptionsForSshProtocol({ ...cur, ...extra });
}

type DockerCtorOptions = NonNullable<ConstructorParameters<typeof Docker>[0]>;

function buildExplicitModemOptions(
  options: ProjectManagerConnectOptions & { host: string },
): DockerCtorOptions {
  const host = options.host.trim();
  const protocol = options.protocol ?? "http";
  let port = options.port;
  if (port == null || port === "") {
    if (protocol === "https") port = 2376;
    else if (protocol === "ssh") port = 22;
    else port = 2375;
  }
  const portStr = typeof port === "number" ? String(port) : String(port);

  if (protocol === "ssh") {
    return {
      host,
      port: portStr,
      protocol: "ssh",
      pathPrefix: "/",
      username: options.username,
      sshOptions: mergeSshOptionsForSshProtocol(options.sshOptions),
    } as DockerCtorOptions;
  }

  return {
    host,
    port: portStr,
    protocol,
    pathPrefix: "/",
  } as DockerCtorOptions;
}

/**
 * Creates a dockerode client from optional {@link ProjectManagerConnectOptions}.
 * With no options (or no `host` / `docker`), uses `new Docker()` so **`DOCKER_HOST`** and the
 * default local socket behave like the Docker CLI.
 *
 * For **`protocol: 'ssh'`** or **`DOCKER_HOST=ssh://…`**: when **`SSH_AUTH_SOCK`** is unset, may
 * merge **`FLUX_DOCKER_SSH_IDENTITY`** or `~/.ssh/id_ed25519` as `sshOptions.privateKey`. When the
 * agent is in use, only the agent is used (encrypted default keys are not loaded from disk).
 * SSH clients get **`keepaliveInterval: 5000`** (5s) unless already set, to reduce idle drops
 * through firewalls during long operations.
 */
export function createFluxDocker(
  options?: ProjectManagerConnectOptions,
): Docker {
  if (options?.docker) {
    augmentDockerSshClientIfNeeded(options.docker);
    applySshEngineKeepalives(options.docker);
    return options.docker;
  }
  assertNoRemoteFieldsWithoutHost(options ?? {});
  const trimmed = options?.host?.trim();
  if (trimmed) {
    const d = new Docker(
      buildExplicitModemOptions({ ...options, host: trimmed }),
    );
    augmentDockerSshClientIfNeeded(d);
    applySshEngineKeepalives(d);
    return d;
  }
  const d = new Docker();
  augmentDockerSshClientIfNeeded(d);
  applySshEngineKeepalives(d);
  return d;
}

/** Human-readable Engine target for logs (prefers `DOCKER_HOST` when set). */
export function formatDockerEngineTarget(docker: Docker): string {
  const dh = process.env.DOCKER_HOST?.trim();
  if (dh) return dh;
  const m = docker.modem as {
    host?: string;
    port?: number | string;
    protocol?: string;
    username?: string;
  };
  if (m.host) {
    const auth = m.username ? `${m.username}@` : "";
    const portPart =
      m.port != null && m.port !== "" ? `:${String(m.port)}` : "";
    return `${String(m.protocol ?? "http")}://${auth}${m.host}${portPart}`;
  }
  return "local-socket (DOCKER_HOST unset; default unix socket or Windows named pipe)";
}

/**
 * When true, Flux refuses to proceed if the Engine cannot be reached (avoids silently using a
 * different daemon than `DOCKER_HOST` / explicit remote options imply).
 */
export function dockerEngineRequiresStrictReachability(docker: Docker): boolean {
  if (process.env.DOCKER_HOST?.trim()) return true;
  const m = docker.modem as { host?: string };
  return Boolean(m.host);
}

/**
 * If {@link dockerEngineRequiresStrictReachability} is true, **`docker.ping()`** must succeed or
 * this throws (no fallback to another socket).
 */
export async function assertFluxDockerEngineReachableOrThrow(
  docker: Docker,
): Promise<void> {
  if (!dockerEngineRequiresStrictReachability(docker)) return;
  try {
    await docker.ping();
  } catch (err: unknown) {
    const target = formatDockerEngineTarget(docker);
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Flux: cannot reach Docker Engine "${target}" (ping failed: ${detail}). ` +
        "DOCKER_HOST is set or a remote host was configured—aborting so we never fall back to a different engine.",
    );
  }
}

export function resolveProjectManagerDocker(
  arg?: Docker | ProjectManagerConnectOptions,
): Docker {
  if (arg instanceof Docker) {
    augmentDockerSshClientIfNeeded(arg);
    applySshEngineKeepalives(arg);
    return arg;
  }
  return createFluxDocker(arg);
}
