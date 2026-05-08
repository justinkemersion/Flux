import { randomBytes } from "node:crypto";
import { PassThrough } from "node:stream";
import * as tar from "tar-stream";
import type Docker from "dockerode";

type ModemDemux = {
  demuxStream: (
    stream: NodeJS.ReadableStream,
    stdout: NodeJS.WritableStream,
    stderr: NodeJS.WritableStream,
  ) => void;
};

function getModem(docker: Docker): ModemDemux {
  return docker.modem as unknown as ModemDemux;
}

async function streamToString(s: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of s) {
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export type ContainerExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

function execErrorSummary(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Transient stream / transport failures over SSH to the Docker host (Hetzner, long RTT, etc.). */
function isSshOrStreamBlip(err: unknown): boolean {
  const s = err instanceof Error ? err.message : String(err);
  return /premature close|ECONNRESET|ETIMEDOUT|EPIPE|hijack|socket|TLS|aborted|reset|broken pipe/i.test(
    s,
  );
}

/** One logical pg_isready: quick sub-retries on stream blips so one bad packet does not burn an outer attempt. */
const PG_ISREADY_INNER_BLIP_RETRIES = 10;

async function execPgIsreadyResilient(
  docker: Docker,
  containerId: string,
): Promise<ContainerExecResult> {
  for (let inner = 0; inner < PG_ISREADY_INNER_BLIP_RETRIES; inner++) {
    try {
      return await dockerContainerExec(docker, containerId, {
        Cmd: ["pg_isready", "-U", "postgres"],
      });
    } catch (err: unknown) {
      const isBlip = isSshOrStreamBlip(err);
      if (!isBlip || inner === PG_ISREADY_INNER_BLIP_RETRIES - 1) {
        throw err;
      }
      await delay(Math.min(200 + inner * 150, 2_000));
    }
  }
  /* Unreachable: each iteration returns or throws. */
  throw new Error("pg_isready: inner retry loop exhausted");
}

/** Default timeout for a single exec operation — covers even large psql imports. */
const DOCKER_EXEC_DEFAULT_TIMEOUT_MS = 900_000;

/**
 * Runs a one-shot exec in a container and collects stdout/stderr.
 *
 * Completion is detected by polling `exec.inspect()` until `Running === false` rather than
 * waiting for the stream to emit `end`. This is required because:
 * - Over a local Unix socket with `hijack: true`, the raw socket often never emits `end`
 *   (https://github.com/apocas/dockerode/issues/534).
 * - Over SSH (`docker system dial-stdio`), the HTTP IncomingMessage can emit `close` before
 *   `end`, causing `stream.finished()` to reject or hang.
 *
 * The PassThrough streams are ended explicitly (`.end()`) after the exec is confirmed
 * finished, which is the correct way to signal end-of-stream to the `for await` loop in
 * `streamToString` — calling `.destroy()` on the mux does NOT end them.
 */
export async function dockerContainerExec(
  docker: Docker,
  containerId: string,
  options: {
    Cmd: string[];
    Env?: string[];
    User?: string;
    /** Milliseconds before the exec is considered hung and an error is thrown. */
    timeoutMs?: number;
  },
): Promise<ContainerExecResult> {
  const timeoutMs = options.timeoutMs ?? DOCKER_EXEC_DEFAULT_TIMEOUT_MS;
  const container = docker.getContainer(containerId);
  const exec = await container.exec({
    AttachStdout: true,
    AttachStderr: true,
    Cmd: options.Cmd,
    Env: options.Env,
    User: options.User,
    Tty: false,
  });

  const raw = (await exec.start({ stdin: false })) as NodeJS.ReadableStream;

  // Absorb raw stream errors — an SSH channel error here would otherwise become an uncaught
  // exception because docker-modem's ssh.js can throw synchronously from agent.createConnection.
  raw.on("error", () => { /* completion is owned by inspect polling below */ });

  const stdout = new PassThrough();
  const stderr = new PassThrough();
  getModem(docker).demuxStream(raw, stdout, stderr);

  const outP = streamToString(stdout);
  const errP = streamToString(stderr);

  // Poll inspect until Running === false.  This is reliable regardless of whether the
  // underlying stream ends cleanly — each inspect() is an independent lightweight GET.
  const deadline = Date.now() + timeoutMs;
  let exitCode = 0;
  while (true) {
    const info = await exec.inspect();
    if (!info.Running) {
      exitCode = typeof info.ExitCode === "number" ? info.ExitCode : 0;
      break;
    }
    if (Date.now() > deadline) {
      stdout.end();
      stderr.end();
      throw new Error(
        `docker exec timed out after ${String(timeoutMs)}ms: ${options.Cmd.join(" ")}`,
      );
    }
    await delay(100);
  }

  // Allow demuxStream's readable events ~50 ms to flush any buffered data into the PassThrough
  // streams before ending them.  For typical short-output commands (pg_isready, psql bootstrap)
  // all output arrives well before inspect() reports Running=false, so this is just insurance.
  await delay(50);
  stdout.end();
  stderr.end();

  return {
    exitCode,
    stdout: await outP,
    stderr: await errP,
  };
}

/**
 * Polls `pg_isready` inside the Postgres container until it succeeds or `maxAttempts` is exceeded.
 * **`docker exec`** or stream failures over SSH (e.g. "Premature close") are retried; each loop ends
 * with a **5s** pause. **`maxAttempts` defaults to 80** (outer rounds; each round also does up to
 * 10 quick sub-retries on stream blips per outer round (see `PG_ISREADY_INNER_BLIP_RETRIES`).
 */
export async function waitPostgresReadyInsideContainer(
  docker: Docker,
  containerId: string,
  options?: {
    maxAttempts?: number;
    onStatus?: (message: string) => void;
  },
): Promise<void> {
  const maxAttempts = options?.maxAttempts ?? 80;
  const onStatus = options?.onStatus;
  let attempt = 0;
  onStatus?.(
    "Waiting for Postgres (pg_isready inside container; new data dirs can take 30–90s)…",
  );
  while (true) {
    attempt++;
    let r: ContainerExecResult;
    try {
      r = await execPgIsreadyResilient(docker, containerId);
    } catch (err: unknown) {
      if (attempt < maxAttempts) {
        if (isSshOrStreamBlip(err)) {
          onStatus?.(
            `SSH connection blipped; retrying health check in 5s… (outer ${String(attempt)}/${String(maxAttempts)})`,
          );
        } else {
          onStatus?.(
            `pg_isready error (${execErrorSummary(err)}); waiting 5s before retry (${String(attempt)}/${String(maxAttempts)})…`,
          );
        }
        await delay(5000);
        continue;
      }
      throw err;
    }
    if (r.exitCode === 0) {
      onStatus?.("Postgres is accepting connections.");
      return;
    }
    if (attempt >= maxAttempts) {
      throw new Error(
        `Postgres was not ready after ${String(maxAttempts)} pg_isready attempts: ${r.stderr || r.stdout || "no output"}`,
      );
    }
    if (attempt === 1 || attempt % 5 === 0) {
      onStatus?.(
        `Postgres not ready (attempt ${String(attempt)}/${String(maxAttempts)}); retrying in 5s…`,
      );
    }
    await delay(5000);
  }
}

function packSingleFileTar(filename: string, sql: string): Promise<Buffer> {
  const body = Buffer.from(sql, "utf8");
  return new Promise((resolve, reject) => {
    const pack = tar.pack();
    const chunks: Buffer[] = [];
    pack.on("data", (c: string | Buffer) => {
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    });
    pack.on("error", reject);
    pack.on("end", () => resolve(Buffer.concat(chunks)));
    pack.entry({ name: filename, size: body.length }, body, (err: Error | null | undefined) => {
      if (err) {
        reject(err);
        return;
      }
      pack.finalize();
    });
  });
}

async function putTarSqlAndRunPsql(
  docker: Docker,
  containerId: string,
  password: string,
  sql: string,
  pgUser: string,
): Promise<void> {
  const remoteName = `flux-${randomBytes(8).toString("hex")}.sql`;
  const remotePath = `/tmp/${remoteName}`;
  const tarBuf = await packSingleFileTar(remoteName, sql);
  const container = docker.getContainer(containerId);
  await container.putArchive(tarBuf, { path: "/tmp" });

  try {
    const run = await dockerContainerExec(docker, containerId, {
      Env: [`PGPASSWORD=${password}`],
      Cmd: [
        "psql",
        "-U",
        pgUser,
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        remotePath,
      ],
    });

    if (run.exitCode !== 0) {
      throw new Error(
        `psql failed (exit ${String(run.exitCode)}): ${run.stderr || run.stdout}`,
      );
    }
  } finally {
    await dockerContainerExec(docker, containerId, {
      Cmd: ["rm", "-f", remotePath],
    });
  }
}

const PSQL_INLINE_MAX = 12_000;

/**
 * Runs arbitrary SQL inside Postgres via `psql` in the container (tar upload for large batches).
 */
export async function runPsqlSqlInsideContainer(
  docker: Docker,
  containerId: string,
  password: string,
  sql: string,
  pgUser: string,
): Promise<void> {
  const trimmed = sql.trim();
  if (trimmed.length <= PSQL_INLINE_MAX && !trimmed.includes("\x00")) {
    const r = await dockerContainerExec(docker, containerId, {
      Env: [`PGPASSWORD=${password}`],
      Cmd: [
        "psql",
        "-U",
        pgUser,
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        trimmed,
      ],
    });
    if (r.exitCode !== 0) {
      throw new Error(
        `psql failed (exit ${String(r.exitCode)}): ${r.stderr || r.stdout}`,
      );
    }
    return;
  }
  await putTarSqlAndRunPsql(docker, containerId, password, sql, pgUser);
}

function stripTrailingSemicolon(sql: string): string {
  return sql.replace(/;\s*$/, "").trim();
}

/**
 * Runs a SELECT and returns rows as parsed JSON objects (one round trip via `json_agg`).
 */
export async function queryPsqlJsonRows(
  docker: Docker,
  containerId: string,
  password: string,
  selectSql: string,
  pgUser: string,
): Promise<unknown[]> {
  const inner = stripTrailingSemicolon(selectSql);
  const wrapped = `SELECT coalesce(json_agg(row_to_json(r)), '[]'::json)::text FROM (${inner}) AS r`;
  const r = await dockerContainerExec(docker, containerId, {
    Env: [`PGPASSWORD=${password}`],
    Cmd: ["psql", "-U", pgUser, "-d", "postgres", "-tAc", wrapped],
  });
  if (r.exitCode !== 0) {
    throw new Error(
      `psql query failed (exit ${String(r.exitCode)}): ${r.stderr || r.stdout}`,
    );
  }
  const text = r.stdout.trim();
  if (!text) return [];
  try {
    return JSON.parse(text) as unknown[];
  } catch (e) {
    throw new Error(
      `Could not parse JSON from psql: ${text.slice(0, 200)}… (${String(e)})`,
    );
  }
}

/**
 * Single-column scalar (e.g. server_version_num).
 */
export async function queryPsqlScalar(
  docker: Docker,
  containerId: string,
  password: string,
  sql: string,
  pgUser: string,
): Promise<string> {
  const r = await dockerContainerExec(docker, containerId, {
    Env: [`PGPASSWORD=${password}`],
    Cmd: ["psql", "-U", pgUser, "-d", "postgres", "-tAc", stripTrailingSemicolon(sql)],
  });
  if (r.exitCode !== 0) {
    throw new Error(
      `psql failed (exit ${String(r.exitCode)}): ${r.stderr || r.stdout}`,
    );
  }
  return r.stdout.trim();
}

/** SQL runner used by {@link movePublicSchemaObjectsToApi} (Docker exec, no host TCP). */
export type FluxPgRunner = {
  query: (
    sql: string,
  ) => Promise<{ rows: unknown[]; rowCount: number }>;
};

export function createFluxPgRunner(
  docker: Docker,
  containerId: string,
  password: string,
  pgUser: string,
): FluxPgRunner {
  return {
    query: async (sql: string) => {
      const trimmed = sql.trim();
      const lower = trimmed.toLowerCase();
      if (/^(begin|commit|rollback)\b/i.test(trimmed)) {
        return { rows: [], rowCount: 0 };
      }
      if (lower.startsWith("select") || lower.startsWith("with")) {
        const rows = await queryPsqlJsonRows(
          docker,
          containerId,
          password,
          sql,
          pgUser,
        );
        return { rows, rowCount: rows.length };
      }
      await runPsqlSqlInsideContainer(
        docker,
        containerId,
        password,
        sql,
        pgUser,
      );
      return { rows: [], rowCount: 0 };
    },
  };
}

/**
 * Runs `psql -f` for a **host filesystem** SQL file by packing it into the container (same as {@link runPsqlSqlInsideContainer} but reads from disk).
 */
export async function runPsqlHostFileInsideContainer(
  docker: Docker,
  containerId: string,
  password: string,
  hostFilePath: string,
  pgUser: string,
): Promise<void> {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile(hostFilePath, "utf8");
  await runPsqlSqlInsideContainer(docker, containerId, password, sql, pgUser);
}
