import chalk from "chalk";
import type { DatabaseAccessPlan } from "@flux/core";
import { getApiClient } from "../api-client";
import type { FluxJson } from "../flux-config";
import { B, hintLine, sectionBanner } from "../cli-layout";
import {
  formatAccessPlanSummary,
  formatGuiConfigText,
} from "../db-access/format";
import {
  DEFAULT_DB_TUNNEL_LOCAL_PORT,
  resolveLocalTunnelPort,
} from "../db-access/local-port";
import {
  buildSshTunnelArgs,
  openSshTunnel,
  resolveRemoteTunnelTarget,
} from "../db-access/ssh-tunnel";
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

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          plan: {
            mode: plan.mode,
            supported: plan.mode === "v1_dedicated" ? plan.supported : plan.supported,
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
    console.log(chalk.yellow(`${B}${plan.previewMessage}`));
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

  if (plan.mode === "v2_shared") {
    throw new Error(plan.previewMessage);
  }
  if (!plan.capabilities.tunnel) {
    throw new Error("Database tunnel is not supported for this project mode.");
  }
  if (!plan.tunnel.sshHost.trim()) {
    throw new Error(
      "SSH host is not configured. Set FLUX_DB_TUNNEL_SSH_HOST or DOCKER_HOST=ssh://user@host before opening a tunnel.",
    );
  }

  const localHost = opts.host?.trim() || plan.tunnel.recommendedLocalHost;
  const requestedPort = opts.localPort ?? DEFAULT_DB_TUNNEL_LOCAL_PORT;
  const localPort = await resolveLocalTunnelPort({
    host: localHost,
    requestedPort,
    strictPort: opts.strictPort === true,
  });

  const resolution = await resolveRemoteTunnelTarget({
    sshHost: plan.tunnel.sshHost,
    sshUser: plan.tunnel.sshUser,
    sshPort: plan.tunnel.sshPort,
    internalHost: plan.database.internalHost,
    containerName: plan.database.containerName,
    ...(opts.identityFile ? { identityFile: opts.identityFile } : {}),
    ...(opts.keepalive === true ? { keepalive: true } : {}),
  });

  if (!resolution.ok) {
    const detail = resolution.diagnostics.join(" ");
    throw new Error(
      `${resolution.message}${detail ? ` ${detail}` : ""}`,
    );
  }

  const tunnelPlan = {
    ...plan,
    tunnel: {
      ...plan.tunnel,
      recommendedLocalHost: localHost as "127.0.0.1",
      recommendedLocalPort: localPort,
    },
  };

  if (opts.printConfig) {
    await cmdDbGuiConfig(name, opts, flux);
    return;
  }

  const sshArgs = buildSshTunnelArgs({
    localHost,
    localPort,
    remoteHost: resolution.remoteHost,
    remotePort: plan.database.internalPort,
    sshHost: plan.tunnel.sshHost,
    sshUser: plan.tunnel.sshUser,
    sshPort: plan.tunnel.sshPort,
    ...(opts.identityFile ? { identityFile: opts.identityFile } : {}),
    ...(opts.keepalive === true ? { keepalive: true } : {}),
  });

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          tunnelOpen: true,
          sshArgs,
          resolutionMethod: resolution.method,
          plan: tunnelPlan,
          guiConfig: formatGuiConfigText(tunnelPlan),
        },
        null,
        2,
      ),
    );
    return;
  }

  sectionBanner("Tunnel open");
  console.log(`${B}Mode:     v1_dedicated`);
  console.log(`${B}Project:  ${slug}`);
  console.log(`${B}Local:    ${localHost}:${String(localPort)}`);
  console.log(
    `${B}Remote:   ${resolution.remoteHost}:${String(plan.database.internalPort)} (${resolution.method})`,
  );
  console.log(`${B}Scope:    dedicated database`);
  console.log();
  sectionBanner("GUI config");
  for (const line of formatGuiConfigText(tunnelPlan)) {
    console.log(`${B}${line}`);
  }
  console.log();
  hintLine("Press Ctrl+C to close the tunnel.");

  const child = openSshTunnel(sshArgs);
  child.stderr?.on("data", (chunk: Buffer | string) => {
    if (opts.verbose) {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      process.stderr.write(text);
    }
  });

  await new Promise<void>((resolve, reject) => {
    const shutdown = (): void => {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    child.once("error", reject);
    child.once("close", (code) => {
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
