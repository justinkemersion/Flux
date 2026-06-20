import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import chalk from "chalk";
import type { DatabaseAccessPlan } from "@flux/core";
import { getApiClient } from "../api-client";
import type { FluxJson } from "../flux-config";
import { ensureRestoreVerifiedLatestBackup } from "../cli-handlers/backup-gate";
import { B, hintLine, sectionBanner } from "../cli-layout";
import {
  buildPsqlEnv,
  openDatabaseTunnel,
  parsePostgresPasswordFromConnectionString,
  pgDumpTenantSchemaArgs,
  resolveDbAccessLevel,
  type DbConnectionAuth,
} from "../db-access/connect";
import {
  formatAccessPlanSummary,
  formatGuiConfigText,
  formatGuiConfigTextWithCredential,
} from "../db-access/format";
import { resolveHash, resolveOptionalName } from "../project-resolve";

export type DbAccessCommonOptions = {
  project?: string;
  hash?: string;
  localPort?: number;
  host?: string;
  strictPort?: boolean;
  sshHost?: string;
  sshUser?: string;
  sshPort?: number;
  identityFile?: string;
  keepalive?: boolean;
  printConfig?: boolean;
  json?: boolean;
  verbose?: boolean;
  readonly?: boolean;
  readwrite?: boolean;
  ttl?: number;
  createTempCredentials?: boolean;
};

export type DbDumpOptions = DbAccessCommonOptions & {
  output?: string;
};

export type DbRestoreOptions = DbAccessCommonOptions & {
  input?: string;
  skipBackupCheck?: boolean;
  yesIKnowThisCanOverwriteData?: boolean;
};

function resolveSlugAndHash(
  name: string | undefined,
  opts: Pick<DbAccessCommonOptions, "project" | "hash">,
  flux: FluxJson | null,
): { slug: string; hash: string } {
  const slug = resolveOptionalName(name ?? opts.project, flux, "positional <name> argument");
  const hash = resolveHash(opts.hash, flux);
  return { slug, hash };
}

async function fetchAccessPlan(
  hash: string,
  opts: DbAccessCommonOptions,
): Promise<DatabaseAccessPlan> {
  const client = getApiClient();
  const query: {
    localPort?: number;
    sshHost?: string;
    sshUser?: string;
    sshPort?: number;
  } = {};
  if (opts.localPort != null) query.localPort = opts.localPort;
  if (opts.sshHost) query.sshHost = opts.sshHost;
  if (opts.sshUser) query.sshUser = opts.sshUser;
  if (opts.sshPort != null) query.sshPort = opts.sshPort;
  return client.getProjectDbAccessPlan(hash, query);
}

async function resolveV2Credential(
  hash: string,
  plan: DatabaseAccessPlan,
  opts: DbAccessCommonOptions,
) {
  if (plan.mode !== "v2_shared") {
    throw new Error("Internal error: expected v2_shared plan.");
  }
  const access = resolveDbAccessLevel({
    readonly: opts.readonly === true,
    readwrite: opts.readwrite === true,
    plan,
  });
  const client = getApiClient();
  return client.createTemporaryProjectDbCredential(hash, {
    access,
    ...(opts.ttl != null ? { ttlSeconds: opts.ttl } : {}),
  });
}

async function resolveV1Auth(hash: string): Promise<DbConnectionAuth> {
  const client = getApiClient();
  const creds = await client.getProjectCredentialsByHash(hash);
  if (creds.mode !== "v1_dedicated") {
    throw new Error("Expected v1_dedicated credentials.");
  }
  return {
    mode: "v1_dedicated",
    username: "postgres",
    password: parsePostgresPasswordFromConnectionString(creds.postgresConnectionString),
  };
}

export async function cmdDbAccessPlan(
  name: string | undefined,
  opts: DbAccessCommonOptions,
  flux: FluxJson | null,
): Promise<void> {
  const { slug, hash } = resolveSlugAndHash(name, opts, flux);
  const plan = await fetchAccessPlan(hash, opts);

  if (opts.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  sectionBanner("Database access plan");
  for (const line of formatAccessPlanSummary(plan)) {
    console.log(`${B}${line}`);
  }
  if (opts.verbose) {
    hintLine(`Resolved slug: ${slug}`);
  }
  console.log();
}

export async function cmdDbGuiConfig(
  name: string | undefined,
  opts: DbAccessCommonOptions,
  flux: FluxJson | null,
): Promise<void> {
  const { hash } = resolveSlugAndHash(name, opts, flux);
  const plan = await fetchAccessPlan(hash, opts);

  if (plan.mode === "v2_shared" && opts.createTempCredentials === true) {
    const credential = await resolveV2Credential(hash, plan, opts);
    const lines = formatGuiConfigTextWithCredential(plan, credential);
    if (opts.json) {
      console.log(JSON.stringify({ plan, credential, guiConfig: lines }, null, 2));
      return;
    }
    sectionBanner("GUI configuration");
    for (const line of lines) {
      console.log(`${B}${line}`);
    }
    console.log();
    console.log(
      chalk.yellow(
        `${B}Temporary password shown once. It is not stored by Flux after this response.`,
      ),
    );
    console.log();
    return;
  }

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          plan: {
            mode: plan.mode,
            supported: plan.supported,
            capabilities: plan.capabilities,
          },
          guiConfig: formatGuiConfigText(plan),
        },
        null,
        2,
      ),
    );
    return;
  }

  sectionBanner("GUI configuration");
  for (const line of formatGuiConfigText(plan)) {
    console.log(`${B}${line}`);
  }
  if (plan.mode === "v2_shared") {
    console.log();
    console.log(
      chalk.dim(
        `${B}Run with --create-temp-credentials while \`flux db tunnel\` is open to print a live username/password.`,
      ),
    );
  }
  console.log();
}

export async function cmdDbTunnel(
  name: string | undefined,
  opts: DbAccessCommonOptions,
  flux: FluxJson | null,
): Promise<void> {
  const { slug, hash } = resolveSlugAndHash(name, opts, flux);
  const plan = await fetchAccessPlan(hash, opts);

  let auth: DbConnectionAuth | undefined;
  if (plan.mode === "v2_shared") {
    const credential = await resolveV2Credential(hash, plan, opts);
    auth = { mode: "v2_shared", credential };
  }

  if (opts.printConfig) {
    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            plan,
            ...(auth?.mode === "v2_shared" ? { credential: auth.credential } : {}),
            guiConfig:
              auth?.mode === "v2_shared"
                ? formatGuiConfigTextWithCredential(plan, auth.credential)
                : formatGuiConfigText(plan),
          },
          null,
          2,
        ),
      );
      return;
    }
    sectionBanner("GUI configuration");
    const lines =
      auth?.mode === "v2_shared"
        ? formatGuiConfigTextWithCredential(plan, auth.credential)
        : formatGuiConfigText(plan);
    for (const line of lines) {
      console.log(`${B}${line}`);
    }
    if (auth?.mode === "v2_shared") {
      console.log();
      console.log(
        chalk.yellow(
          `${B}Temporary password shown once. Run \`flux db tunnel\` to open the SSH tunnel next.`,
        ),
      );
    }
    console.log();
    return;
  }

  const localHost = opts.host?.trim() || plan.tunnel.recommendedLocalHost;
  const opened = await openDatabaseTunnel({
    plan,
    localHost,
    ...(opts.localPort != null ? { localPort: opts.localPort } : {}),
    ...(opts.strictPort === true ? { strictPort: true } : {}),
    ...(opts.identityFile ? { identityFile: opts.identityFile } : {}),
    ...(opts.keepalive === true ? { keepalive: true } : {}),
  });

  const guiLines =
    auth?.mode === "v2_shared"
      ? formatGuiConfigTextWithCredential(opened.tunnelPlan, auth.credential)
      : formatGuiConfigText(opened.tunnelPlan);

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          tunnelOpen: true,
          sshArgs: opened.sshArgs,
          resolutionMethod: opened.resolutionMethod,
          plan: opened.tunnelPlan,
          ...(auth ? { auth: { mode: auth.mode, username: auth.mode === "v2_shared" ? auth.credential.username : auth.username } } : {}),
          guiConfig: guiLines,
        },
        null,
        2,
      ),
    );
    return;
  }

  sectionBanner("Tunnel open");
  console.log(`${B}Mode:     ${plan.mode}`);
  console.log(`${B}Project:  ${slug}`);
  console.log(`${B}Local:    ${opened.localHost}:${String(opened.localPort)}`);
  console.log(
    `${B}Remote:   ${opened.remoteHost}:${String(plan.database.internalPort)} (${opened.resolutionMethod})`,
  );
  console.log(
    `${B}Scope:    ${plan.mode === "v2_shared" ? `tenant schema ${plan.tenantSchema}` : "dedicated database"}`,
  );
  if (auth?.mode === "v2_shared") {
    console.log(`${B}User:     ${auth.credential.username}`);
    console.log(`${B}Expires:  ${auth.credential.expiresAt}`);
  }
  console.log();
  sectionBanner("GUI config");
  for (const line of guiLines) {
    console.log(`${B}${line}`);
  }
  if (auth?.mode === "v2_shared") {
    console.log();
    console.log(
      chalk.yellow(
        `${B}Temporary password shown once in GUI config above. Flux does not store it.`,
      ),
    );
  }
  console.log();
  hintLine("Press Ctrl+C to close the tunnel.");

  opened.child.stderr?.on("data", (chunk: Buffer | string) => {
    if (opts.verbose) {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      process.stderr.write(text);
    }
  });

  await new Promise<void>((resolve, reject) => {
    const shutdown = (): void => {
      if (!opened.child.killed) {
        opened.child.kill("SIGTERM");
      }
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    opened.child.once("error", reject);
    opened.child.once("close", (code) => {
      process.removeListener("SIGINT", shutdown);
      process.removeListener("SIGTERM", shutdown);
      if (code != null && code !== 0) {
        reject(new Error(`SSH tunnel exited with code ${String(code)}.`));
        return;
      }
      resolve();
    });
  });
}

export async function cmdDbShell(
  name: string | undefined,
  opts: DbAccessCommonOptions,
  flux: FluxJson | null,
): Promise<void> {
  const { slug, hash } = resolveSlugAndHash(name, opts, flux);
  const plan = await fetchAccessPlan(hash, opts);

  if (plan.mode === "v2_shared" && !plan.capabilities.shell) {
    throw new Error("Interactive shell is not supported for this project.");
  }

  let auth: DbConnectionAuth;
  if (plan.mode === "v2_shared") {
    auth = {
      mode: "v2_shared",
      credential: await resolveV2Credential(hash, plan, opts),
    };
  } else {
    auth = await resolveV1Auth(hash);
  }

  const opened = await openDatabaseTunnel({
    plan,
    localHost: opts.host?.trim() || plan.tunnel.recommendedLocalHost,
    ...(opts.localPort != null ? { localPort: opts.localPort } : {}),
    ...(opts.strictPort === true ? { strictPort: true } : {}),
    ...(opts.identityFile ? { identityFile: opts.identityFile } : {}),
    ...(opts.keepalive === true ? { keepalive: true } : {}),
  });

  const username =
    auth.mode === "v2_shared" ? auth.credential.username : auth.username;
  const psql = spawn(
    "psql",
    [
      "-h",
      opened.localHost,
      "-p",
      String(opened.localPort),
      "-U",
      username,
      "-d",
      "postgres",
    ],
    {
      stdio: "inherit",
      env: buildPsqlEnv(auth),
    },
  );

  await new Promise<void>((resolve, reject) => {
    const shutdown = (): void => {
      psql.kill("SIGTERM");
      if (!opened.child.killed) opened.child.kill("SIGTERM");
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    psql.once("error", reject);
    psql.once("close", (code) => {
      shutdown();
      process.removeListener("SIGINT", shutdown);
      process.removeListener("SIGTERM", shutdown);
      if (code != null && code !== 0) {
        reject(new Error(`psql exited with code ${String(code)}.`));
        return;
      }
      resolve();
    });
  });

  if (opts.verbose) {
    hintLine(`Closed shell for ${slug}.`);
  }
}

export async function cmdDbDump(
  name: string | undefined,
  opts: DbDumpOptions,
  flux: FluxJson | null,
): Promise<void> {
  const { slug, hash } = resolveSlugAndHash(name, opts, flux);
  const plan = await fetchAccessPlan(hash, opts);

  if (plan.mode !== "v2_shared" || !plan.capabilities.dump) {
    throw new Error(
      "Schema-scoped dump is only supported for v2_shared projects on this platform.",
    );
  }

  const credential = await resolveV2Credential(hash, plan, opts);
  const outputPath = opts.output?.trim() || `${slug}.dump`;
  const opened = await openDatabaseTunnel({
    plan,
    localHost: opts.host?.trim() || plan.tunnel.recommendedLocalHost,
    ...(opts.localPort != null ? { localPort: opts.localPort } : {}),
    ...(opts.strictPort === true ? { strictPort: true } : {}),
    ...(opts.identityFile ? { identityFile: opts.identityFile } : {}),
    ...(opts.keepalive === true ? { keepalive: true } : {}),
  });

  const args = pgDumpTenantSchemaArgs({
    localHost: opened.localHost,
    localPort: opened.localPort,
    username: credential.username,
    tenantSchema: plan.tenantSchema,
  });

  await new Promise<void>((resolve, reject) => {
    const child = spawn("pg_dump", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: buildPsqlEnv({ mode: "v2_shared", credential }),
    });
    const stderrChunks: Buffer[] = [];
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.once("error", (err) => {
      if (!opened.child.killed) opened.child.kill("SIGTERM");
      reject(err);
    });
    if (!child.stdout) {
      if (!opened.child.killed) opened.child.kill("SIGTERM");
      reject(new Error("pg_dump: missing stdout pipe."));
      return;
    }
    pipeline(child.stdout, createWriteStream(outputPath))
      .then(() => {
        child.once("close", (code) => {
          if (!opened.child.killed) opened.child.kill("SIGTERM");
          if (code !== 0) {
            const stderrText = Buffer.concat(stderrChunks).toString("utf8").trim();
            reject(
              new Error(
                stderrText.length > 0
                  ? `pg_dump failed (${String(code)}): ${stderrText.slice(0, 2000)}`
                  : `pg_dump failed (exit ${String(code)}).`,
              ),
            );
            return;
          }
          resolve();
        });
      })
      .catch((err) => {
        if (!opened.child.killed) opened.child.kill("SIGTERM");
        reject(err);
      });
  });

  if (opts.json) {
    console.log(JSON.stringify({ ok: true, output: outputPath, schema: plan.tenantSchema }, null, 2));
    return;
  }
  console.log(`${B}Wrote schema-scoped dump to ${outputPath}`);
}

export async function cmdDbRestore(
  name: string | undefined,
  opts: DbRestoreOptions,
  flux: FluxJson | null,
): Promise<void> {
  const { hash } = resolveSlugAndHash(name, opts, flux);
  const plan = await fetchAccessPlan(hash, opts);

  if (plan.mode === "v2_shared") {
    throw new Error(
      "Restore into a production pooled tenant schema is not supported. " +
        "Restore to a scratch or dedicated project instead.",
    );
  }

  if (!opts.yesIKnowThisCanOverwriteData) {
    throw new Error(
      "Restore can overwrite project data. Re-run with --yes-i-know-this-can-overwrite-data.",
    );
  }

  const client = getApiClient();
  await ensureRestoreVerifiedLatestBackup(
    client,
    hash,
    opts.skipBackupCheck === true,
  );

  const inputPath = opts.input?.trim();
  if (!inputPath) {
    throw new Error("Provide --input <path> to a pg_restore-compatible dump file.");
  }

  const auth = await resolveV1Auth(hash);
  const opened = await openDatabaseTunnel({
    plan,
    localHost: opts.host?.trim() || plan.tunnel.recommendedLocalHost,
    ...(opts.localPort != null ? { localPort: opts.localPort } : {}),
    ...(opts.strictPort === true ? { strictPort: true } : {}),
    ...(opts.identityFile ? { identityFile: opts.identityFile } : {}),
    ...(opts.keepalive === true ? { keepalive: true } : {}),
  });

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "pg_restore",
      [
        "-h",
        opened.localHost,
        "-p",
        String(opened.localPort),
        "-U",
        auth.username,
        "-d",
        "postgres",
        "--clean",
        "--if-exists",
        inputPath,
      ],
      {
        stdio: "inherit",
        env: buildPsqlEnv(auth),
      },
    );
    child.once("error", reject);
    child.once("close", (code) => {
      if (!opened.child.killed) opened.child.kill("SIGTERM");
      if (code != null && code !== 0) {
        reject(new Error(`pg_restore exited with code ${String(code)}.`));
        return;
      }
      resolve();
    });
  });

  if (opts.json) {
    console.log(JSON.stringify({ ok: true, input: inputPath }, null, 2));
    return;
  }
  console.log(`${B}Restore completed from ${inputPath}`);
}
