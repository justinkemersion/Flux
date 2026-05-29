import { PassThrough, Readable } from "node:stream";
import jwt from "jsonwebtoken";

import { POSTGRES_USER } from "../../docker/docker-constants.ts";
import { postgresContainerName, postgrestContainerName } from "../../docker/docker-names.ts";
import type { FluxCoreContext } from "../../runtime/context.ts";
import { slugifyProjectName } from "../../standalone.ts";
import { getDockerEngineHttpStatus } from "../delete-docker-tenant-stack.ts";
import {
  postgresDockerInternalUri,
  readPgrstJwtSecretFromContainerEnv,
} from "./docker-helpers.ts";
import type { FluxProjectCredentials, ProjectDumpOptions } from "./types.ts";

export async function resolveRunningPostgresCredentials(
  ctx: FluxCoreContext,
  projectName: string,
  hash: string,
): Promise<{
  slug: string;
  hash: string;
  containerId: string;
  containerName: string;
  password: string;
}> {
  const slug = slugifyProjectName(projectName);
  const containerName = postgresContainerName(hash, slug);

  const containers = await ctx.docker.listContainers({
    all: true,
    filters: { name: [containerName] },
  });
  const match = containers.find((c) =>
    c.Names?.some((n) => n === `/${containerName}` || n === containerName),
  );
  if (!match) {
    throw new Error(
      `No Postgres container found for project "${projectName}" (expected "${containerName}").`,
    );
  }
  if (match.State !== "running") {
    throw new Error(
      `Postgres container "${containerName}" exists but is not running (state: ${match.State}).`,
    );
  }

  const inspect = await ctx.docker.getContainer(match.Id).inspect();

  const password = inspect.Config.Env?.find((e) =>
    e.startsWith("POSTGRES_PASSWORD="),
  )?.slice("POSTGRES_PASSWORD=".length);
  if (!password) {
    throw new Error(
      `Could not retrieve POSTGRES_PASSWORD from container "${containerName}".`,
    );
  }

  return { slug, hash, containerId: inspect.Id, containerName, password };
}

/**
 * Postgres URI using the DB container’s Docker DNS hostname. **Customer** project databases are on
 * the **tenant private** network only, so they are not reachable from arbitrary `flux-network`
 * clients. The **`flux-system`** project is an exception: its Postgres is also on
 * {@link FLUX_NETWORK_NAME} for the control plane (dashboard) `Pool` connection. For other tenants,
 * use `docker exec` / or connect from a container on that tenant’s private network (e.g. PostgREST).
 */
export async function getPostgresHostConnectionString(
  ctx: FluxCoreContext,
  projectName: string,
  hash: string,
): Promise<string> {
  const { password, containerName } =
    await resolveRunningPostgresCredentials(ctx, projectName, hash);
  return postgresDockerInternalUri(containerName, password);
}

/**
 * Reads `PGRST_JWT_SECRET` from the running PostgREST container’s `inspect().Config.Env` and signs
 * anon / service_role JWTs with that same material — never invents a new secret.
 */
export async function getProjectKeys(
  ctx: FluxCoreContext,
  slug: string,
  hash: string,
): Promise<{ anonKey: string; serviceRoleKey: string }> {
  const normalized = slugifyProjectName(slug);
  const apiName = postgrestContainerName(hash, normalized);
  let inspect: Awaited<ReturnType<import("dockerode").Container["inspect"]>>;
  try {
    inspect = await ctx.docker.getContainer(apiName).inspect();
  } catch (err: unknown) {
    if (getDockerEngineHttpStatus(err) === 404) {
      throw new Error(
        `No PostgREST container found for slug "${normalized}" (expected "${apiName}").`,
      );
    }
    throw err;
  }

  const secret = readPgrstJwtSecretFromContainerEnv(inspect, apiName);

  const anonKey = jwt.sign({ role: "anon" }, secret);
  const serviceRoleKey = jwt.sign({ role: "service_role" }, secret);
  return { anonKey, serviceRoleKey };
}

/**
 * Loads Postgres host URI and JWT-backed API keys for a project. Prefer this over pairing
 * {@link getPostgresHostConnectionString} + {@link getProjectKeys} when exposing secrets to a UI,
 * so list endpoints stay non-sensitive.
 */
export async function getProjectCredentials(
  ctx: FluxCoreContext,
  projectName: string,
  hash: string,
): Promise<FluxProjectCredentials> {
  const slug = slugifyProjectName(projectName);
  const [postgresConnectionString, keys] = await Promise.all([
    getPostgresHostConnectionString(ctx, slug, hash),
    getProjectKeys(ctx, slug, hash),
  ]);
  return {
    postgresConnectionString,
    anonKey: keys.anonKey,
    serviceRoleKey: keys.serviceRoleKey,
  };
}

/**
 * Streams a plain SQL `pg_dump` from the running tenant Postgres container.
 *
 * Flags:
 * - `schemaOnly` => `-s`
 * - `dataOnly` => `-a`
 * - `clean` => `-c --if-exists`
 * - `publicOnly` => `-n public`
 */
export async function getProjectDumpStream(
  ctx: FluxCoreContext,
  slug: string,
  hash: string,
  options?: ProjectDumpOptions,
): Promise<Readable> {
  if (options?.schemaOnly === true && options?.dataOnly === true) {
    throw new Error("schemaOnly and dataOnly cannot both be true.");
  }
  const creds = await resolveRunningPostgresCredentials(ctx, slug, hash);
  const args = ["-U", POSTGRES_USER, "-d", "postgres"] as string[];
  if (options?.schemaOnly === true) args.push("-s");
  if (options?.dataOnly === true) args.push("-a");
  if (options?.clean === true) args.push("-c", "--if-exists");
  if (options?.publicOnly === true) args.push("-n", "public");

  const exec = await ctx.docker.getContainer(creds.containerId).exec({
    AttachStdout: true,
    AttachStderr: true,
    Cmd: ["pg_dump", ...args],
    Env: [`PGPASSWORD=${creds.password}`],
  });

  const io = await exec.start({
    hijack: true,
    stdin: false,
  });
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stderrChunks: Buffer[] = [];
  stderr.on("data", (chunk: Buffer | string | Uint8Array) => {
    stderrChunks.push(
      Buffer.isBuffer(chunk)
        ? chunk
        : typeof chunk === "string"
          ? Buffer.from(chunk, "utf8")
          : Buffer.from(chunk),
    );
  });

  ctx.docker.modem.demuxStream(
    io as unknown as NodeJS.ReadWriteStream,
    stdout,
    stderr,
  );

  const finalize = async (): Promise<void> => {
    const state = await exec.inspect();
    const code = state.ExitCode ?? 1;
    if (code !== 0) {
      const stderrText = Buffer.concat(stderrChunks).toString("utf8").trim();
      stdout.destroy(
        new Error(
          stderrText.length > 0
            ? `pg_dump failed (${String(code)}): ${stderrText}`
            : `pg_dump failed (${String(code)}).`,
        ),
      );
      return;
    }
    stdout.end();
  };
  io.on("end", () => {
    void finalize();
  });
  io.on("error", (err: Error) => {
    stdout.destroy(err);
  });

  return stdout;
}

/**
 * Streams a PostgreSQL custom-format backup (`pg_dump -Fc`) from a running tenant Postgres.
 * Intended for restoreable backup artifacts (compressed/custom format for `pg_restore`).
 */
export async function getProjectCustomBackupStream(
  ctx: FluxCoreContext,
  slug: string,
  hash: string,
): Promise<Readable> {
  const creds = await resolveRunningPostgresCredentials(ctx, slug, hash);
  const exec = await ctx.docker.getContainer(creds.containerId).exec({
    AttachStdout: true,
    AttachStderr: true,
    Cmd: [
      "pg_dump",
      "-U",
      POSTGRES_USER,
      "-d",
      "postgres",
      "-Fc",
      "--no-owner",
      "--no-acl",
    ],
    Env: [`PGPASSWORD=${creds.password}`],
  });
  const io = await exec.start({
    hijack: true,
    stdin: false,
  });
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stderrChunks: Buffer[] = [];
  stderr.on("data", (chunk: Buffer | string | Uint8Array) => {
    stderrChunks.push(
      Buffer.isBuffer(chunk)
        ? chunk
        : typeof chunk === "string"
          ? Buffer.from(chunk, "utf8")
          : Buffer.from(chunk),
    );
  });
  ctx.docker.modem.demuxStream(
    io as unknown as NodeJS.ReadWriteStream,
    stdout,
    stderr,
  );
  const finalize = async (): Promise<void> => {
    const state = await exec.inspect();
    const code = state.ExitCode ?? 1;
    if (code !== 0) {
      const stderrText = Buffer.concat(stderrChunks).toString("utf8").trim();
      stdout.destroy(
        new Error(
          stderrText.length > 0
            ? `pg_dump -Fc failed (${String(code)}): ${stderrText}`
            : `pg_dump -Fc failed (${String(code)}).`,
        ),
      );
      return;
    }
    stdout.end();
  };
  io.on("end", () => {
    void finalize();
  });
  io.on("error", (err: Error) => {
    stdout.destroy(err);
  });
  return stdout;
}

/**
 * POSTGRES_PASSWORD from the running tenant Postgres container (must be running).
 * For HMAC-only dev flows without a live container, use
 * {@link deriveTenantPostgresPasswordFromSecret} instead.
 */
export async function getPostgresSuperuserPassword(
  ctx: FluxCoreContext,
  projectName: string,
  hash: string,
): Promise<string> {
  const { password } = await resolveRunningPostgresCredentials(
    ctx,
    projectName,
    hash,
  );
  return password;
}
