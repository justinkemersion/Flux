import { once } from "node:events";
import chalk from "chalk";
import open from "open";
import { getApiClient } from "../api-client";
import { resolveDashboardBase } from "../dashboard-base";
import type { FluxJson } from "../flux-config";
import { resolveHash, resolveProjectSlug } from "../project-resolve";

export async function cmdOpen(
  name: string | undefined,
  projectOpt: string | undefined,
  cliHash: string | undefined,
  flux: FluxJson | null,
): Promise<void> {
  const fromCli = projectOpt?.trim() || name;
  const slug = resolveProjectSlug(
    fromCli,
    flux,
    "positional <name> or -p, --project",
  );
  resolveHash(cliHash, flux);
  const base = resolveDashboardBase();
  const url = new URL(
    `/projects/${encodeURIComponent(slug)}`,
    base,
  ).href;
  console.log(`Opening Mesh Readout for ${slug}...`);
  await open(url);
}

function formatLogLineForTerminal(
  line: string,
  service: "api" | "db",
): string {
  const label = service === "api" ? "api" : "db";
  const head = chalk.bold(`[${label}]`);
  const m = line.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(.*)$/s,
  );
  if (m) {
    return `${head} ${chalk.dim(m[1]!)} ${m[2]!}`;
  }
  return `${head} ${line}`;
}

export async function cmdLogs(
  name: string | undefined,
  projectOpt: string | undefined,
  service: "api" | "db",
  hash: string | undefined,
  flux: FluxJson | null,
): Promise<void> {
  const fromCli = projectOpt?.trim() || name;
  const slug = resolveProjectSlug(
    fromCli,
    flux,
    "positional [name] or -p, --project",
  );
  const h = resolveHash(hash, flux);
  const client = getApiClient();
  const ac = new AbortController();
  const onSig = (): void => {
    ac.abort();
  };
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);
  try {
    try {
      await client.streamContainerLogs(
        { slug, hash: h, service },
        (ev) => {
          if (ev.line != null) {
            console.log(formatLogLineForTerminal(ev.line, service));
          }
        },
        { signal: ac.signal },
      );
    } catch (e: unknown) {
      if (
        e instanceof Error &&
        (e.name === "AbortError" ||
          /aborted|The operation was aborted/i.test(e.message))
      ) {
        return;
      }
      throw e;
    }
  } finally {
    process.off("SIGINT", onSig);
    process.off("SIGTERM", onSig);
  }
}
