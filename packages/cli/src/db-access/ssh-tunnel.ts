import { spawn } from "node:child_process";

export type RemoteTargetResolution =
  | {
      ok: true;
      remoteHost: string;
      method: "getent" | "docker_inspect";
    }
  | {
      ok: false;
      reason:
        | "ssh_failed"
        | "permission_denied"
        | "docker_not_installed"
        | "container_not_found"
        | "multiple_ips"
        | "unresolved";
      message: string;
      diagnostics: string[];
    };

export type SshExecInput = {
  sshHost: string;
  sshUser: string;
  sshPort: number;
  identityFile?: string;
  remoteCommand: string;
  keepalive?: boolean;
};

export function buildBaseSshArgs(input: {
  sshPort: number;
  identityFile?: string;
  keepalive?: boolean;
}): string[] {
  const args = ["-p", String(input.sshPort), "-o", "BatchMode=yes"];
  if (input.keepalive !== false) {
    args.push(
      "-o",
      "ServerAliveInterval=30",
      "-o",
      "ServerAliveCountMax=3",
    );
  }
  if (input.identityFile) {
    args.push("-i", input.identityFile);
  }
  return args;
}

export function buildSshExecArgs(
  input: SshExecInput & { sshHost: string; sshUser: string },
): string[] {
  return [
    ...buildBaseSshArgs(input),
    `${input.sshUser}@${input.sshHost}`,
    input.remoteCommand,
  ];
}

export function buildSshTunnelArgs(input: {
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  sshHost: string;
  sshUser: string;
  sshPort: number;
  identityFile?: string;
  keepalive?: boolean;
}): string[] {
  return [
    "-N",
    "-L",
    `${input.localHost}:${String(input.localPort)}:${input.remoteHost}:${String(input.remotePort)}`,
    ...buildBaseSshArgs({
      sshPort: input.sshPort,
      ...(input.identityFile ? { identityFile: input.identityFile } : {}),
      ...(input.keepalive === true ? { keepalive: true } : {}),
    }),
    "-o",
    "ExitOnForwardFailure=yes",
    `${input.sshUser}@${input.sshHost}`,
  ];
}

function parseIpFromGetentOutput(stdout: string): string | null {
  const line = stdout
    .split(/\r?\n/u)
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (!line) return null;
  const first = line.split(/\s+/u)[0];
  if (!first || !/^\d+\.\d+\.\d+\.\d+$/u.test(first)) return null;
  return first;
}

function classifySshFailure(stderr: string, code: number | null): RemoteTargetResolution {
  const text = stderr.trim();
  if (/permission denied/i.test(text)) {
    return {
      ok: false,
      reason: "permission_denied",
      message: "SSH authentication failed.",
      diagnostics: [text.slice(0, 400)],
    };
  }
  if (/connection refused|timed out|could not resolve/i.test(text)) {
    return {
      ok: false,
      reason: "ssh_failed",
      message: "Could not reach the SSH host.",
      diagnostics: [text.slice(0, 400)],
    };
  }
  return {
    ok: false,
    reason: "ssh_failed",
    message: `SSH command failed (exit ${String(code ?? "?")}).`,
    diagnostics: text ? [text.slice(0, 400)] : [],
  };
}

export async function runSshCommand(
  input: SshExecInput & { sshHost: string; sshUser: string },
  spawnFn: typeof spawn = spawn,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnFn("ssh", buildSshExecArgs(input), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });
  });
}

export async function resolveRemoteTunnelTarget(input: {
  sshHost: string;
  sshUser: string;
  sshPort: number;
  identityFile?: string;
  internalHost: string;
  containerName?: string;
  keepalive?: boolean;
  spawnFn?: typeof spawn;
}): Promise<RemoteTargetResolution> {
  const diagnostics: string[] = [];
  const spawnFn = input.spawnFn ?? spawn;

  if (!input.sshHost.trim()) {
    return {
      ok: false,
      reason: "ssh_failed",
      message:
        "SSH host is not configured. Set FLUX_DB_TUNNEL_SSH_HOST or DOCKER_HOST=ssh://…",
      diagnostics,
    };
  }

  const getent = await runSshCommand(
    {
      ...input,
      remoteCommand: `getent hosts ${input.internalHost}`,
    },
    spawnFn,
  );
  if (getent.code === 0) {
    const ip = parseIpFromGetentOutput(getent.stdout);
    if (ip) {
      return { ok: true, remoteHost: ip, method: "getent" };
    }
  } else {
    diagnostics.push(
      getent.stderr.trim() ||
        `getent hosts ${input.internalHost} failed (exit ${String(getent.code)}).`,
    );
  }

  const containerName = input.containerName ?? input.internalHost;
  const inspectTemplate =
    "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}";
  const inspect = await runSshCommand(
    {
      ...input,
      remoteCommand:
        `docker inspect -f '${inspectTemplate}' ${containerName}`,
    },
    spawnFn,
  );

  if (inspect.code !== 0) {
    const stderr = inspect.stderr.trim();
    if (/permission denied while trying to connect to the Docker daemon/i.test(stderr)) {
      return {
        ok: false,
        reason: "permission_denied",
        message: "Docker permission denied on the SSH host.",
        diagnostics: [...diagnostics, stderr.slice(0, 400)],
      };
    }
    if (/Cannot connect to the Docker daemon|docker: not found|command not found/i.test(stderr)) {
      return {
        ok: false,
        reason: "docker_not_installed",
        message: "Docker is unavailable on the SSH host.",
        diagnostics: [...diagnostics, stderr.slice(0, 400)],
      };
    }
    if (/No such object|Error: No such container/i.test(stderr)) {
      return {
        ok: false,
        reason: "container_not_found",
        message: `Container "${containerName}" was not found on the SSH host.`,
        diagnostics: [...diagnostics, stderr.slice(0, 400)],
      };
    }
    const sshFailure = classifySshFailure(stderr, inspect.code);
    if (!sshFailure.ok) {
      return {
        ...sshFailure,
        diagnostics: [...diagnostics, ...sshFailure.diagnostics],
      };
    }
    return sshFailure;
  }

  const ips = inspect.stdout
    .trim()
    .split(/\s+/u)
    .map((part) => part.trim())
    .filter((part) => /^\d+\.\d+\.\d+\.\d+$/u.test(part));
  const unique = [...new Set(ips)];
  if (unique.length === 1) {
    return { ok: true, remoteHost: unique[0]!, method: "docker_inspect" };
  }
  if (unique.length > 1) {
    return {
      ok: false,
      reason: "multiple_ips",
      message:
        `Container "${containerName}" is attached to multiple Docker networks. ` +
        "Resolve the project network manually or set an explicit tunnel target.",
      diagnostics: [...diagnostics, `IPs: ${unique.join(", ")}`],
    };
  }

  return {
    ok: false,
    reason: "unresolved",
    message: "Could not resolve a remote tunnel target for this project database.",
    diagnostics,
  };
}

export function openSshTunnel(
  args: string[],
  spawnFn: typeof spawn = spawn,
): ReturnType<typeof spawn> {
  return spawnFn("ssh", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
}
