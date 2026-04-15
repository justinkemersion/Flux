import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Resolve `psql` on the host (`command -v psql`). Used so imports do not rely on Docker HTTP
 * attach stdin, which can hang with docker-modem.
 */
export function resolveHostPsqlExecutable(): string | null {
  try {
    const p = execFileSync("command", ["-v", "psql"], {
      encoding: "utf8",
    }).trim();
    return p.length > 0 ? p : null;
  } catch {
    return null;
  }
}

async function runViaHostPsql(
  psql: string,
  options: {
    hostPort: number;
    password: string;
    sqlPath: string;
    pgUser: string;
  },
): Promise<void> {
  try {
    await execFileAsync(
      psql,
      [
        "-h",
        "127.0.0.1",
        "-p",
        String(options.hostPort),
        "-U",
        options.pgUser,
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        options.sqlPath,
      ],
      {
        env: { ...process.env, PGPASSWORD: options.password },
        maxBuffer: 32 * 1024 * 1024,
      },
    );
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    const detail = e.stderr ?? e.message ?? String(err);
    throw new Error(`psql failed: ${detail}`);
  }
}

async function runViaDockerCpAndExec(options: {
  hostPort: number;
  password: string;
  sqlPath: string;
  pgUser: string;
  containerName: string;
}): Promise<void> {
  const remoteName = `flux-import-${randomBytes(8).toString("hex")}.sql`;
  const remotePath = `/tmp/${remoteName}`;

  try {
    await execFileAsync("docker", [
      "cp",
      options.sqlPath,
      `${options.containerName}:${remotePath}`,
    ]);
  } catch (err: unknown) {
    throw new Error(
      `docker cp failed (${String(err)}). Install the Docker CLI, or install psql on the host so imports can use localhost:${String(options.hostPort)} directly.`,
    );
  }

  try {
    await execFileAsync(
      "docker",
      [
        "exec",
        "-e",
        `PGPASSWORD=${options.password}`,
        options.containerName,
        "psql",
        "-U",
        options.pgUser,
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        remotePath,
      ],
      { maxBuffer: 32 * 1024 * 1024 },
    );
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    const detail = e.stderr ?? e.message ?? String(err);
    throw new Error(`psql in container failed: ${detail}`);
  } finally {
    try {
      await execFileAsync("docker", [
        "exec",
        options.containerName,
        "rm",
        "-f",
        remotePath,
      ]);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Runs `psql -f` against the tenant DB: **host `psql`** to `127.0.0.1:hostPort` if available,
 * otherwise **`docker cp` + `docker exec psql -f`** (no Docker API attach stream).
 */
export async function runTenantPsqlFile(options: {
  hostPort: number;
  password: string;
  sqlPath: string;
  pgUser: string;
  containerName: string;
}): Promise<void> {
  const hostPsql = resolveHostPsqlExecutable();
  if (hostPsql) {
    await runViaHostPsql(hostPsql, options);
    return;
  }
  await runViaDockerCpAndExec({
    hostPort: options.hostPort,
    password: options.password,
    sqlPath: options.sqlPath,
    pgUser: options.pgUser,
    containerName: options.containerName,
  });
}
