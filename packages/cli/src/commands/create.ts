import { buildFluxAppDotEnvSnippet } from "@flux/core/standalone";
import chalk from "chalk";
import ora from "ora";
import type { CreateProjectMode, CreateProjectResult } from "../api-client";
import { getApiClient } from "../api-client";
import {
  boxBottom,
  boxLine,
  boxSep,
  boxTop,
  B,
  hintLine,
  printlnCopyEnvSnippetLine,
} from "../cli-layout";
import { getVisibleLength } from "../utils/terminal.js";

const GENERATED_MARKER =
  "# --- FLUX GENERATED CONFIG [DO NOT BORDER THIS] ---";

function mergeFluxGatewaySecretIntoAppSnippet(
  snippet: string,
  secret: string,
): string {
  return snippet.replace(
    /FLUX_GATEWAY_JWT_SECRET=\s*$/m,
    `FLUX_GATEWAY_JWT_SECRET=${secret}`,
  );
}

function printProjectSummaryCard(
  result: CreateProjectResult,
  nameArg: string,
): void {
  const { summary, secrets, mode } = result;
  /** Visible width between the left `│` and right `│` on boxed rows. */
  const inner = 56;
  const margin = B;

  const row = (key: string, val: string): void => {
    const keyPlain = key.padEnd(16);
    const keyStyled = chalk.yellow(keyPlain);
    const maxVal = Math.max(0, inner - getVisibleLength(keyStyled));
    let valPlain = val;
    if (valPlain.length > maxVal) {
      valPlain = `${valPlain.slice(0, Math.max(0, maxVal - 1))}…`;
    }
    const valStyled = chalk.white(valPlain);
    boxLine(inner, `${keyStyled}${valStyled}`, margin);
  };

  console.log();
  console.log(
    `${margin}${chalk.bold("Created")} ${chalk.bold.cyan(summary.slug)} ${chalk.bold.yellow(`#${summary.hash}`)}`,
  );
  hintLine(`name (input): ${nameArg}`);
  console.log();

  boxTop(inner, margin);
  const titleStyled = chalk.bold.cyan("PROJECT SUMMARY");
  const titlePad = " ".repeat(
    Math.max(0, inner - getVisibleLength(titleStyled)),
  );
  boxLine(inner, `${titleStyled}${titlePad}`, margin);
  boxSep(inner, margin);
  row("slug", summary.slug);
  row("hash", summary.hash);
  row("mode", mode);
  row("status", summary.status);
  boxBottom(inner, margin);

  console.log();
  console.log(`${B}${chalk.dim("POSTGREST API")}`);
  console.log(chalk.white(summary.apiUrl));
  console.log();

  console.log(`${B}${chalk.dim("APP .ENV")}`);
  hintLine(
    "Paste into .env or .env.local (or a new file). For `flux push`, add ./flux.json with the same slug and hash above.",
  );
  const tenantJwt =
    result.projectJwtSecret ?? secrets.pgrstJwtSecret;
  const baseSnippet = buildFluxAppDotEnvSnippet(summary.apiUrl);
  const mergedBody = mergeFluxGatewaySecretIntoAppSnippet(
    baseSnippet,
    tenantJwt,
  );
  const merged = `${GENERATED_MARKER}\n${mergedBody}`;
  for (const line of merged.split("\n")) {
    printlnCopyEnvSnippetLine(line);
  }
  console.log();

  console.log(`${B}${chalk.dim("OTHER_RUNTIME_SECRETS (reference)")}`);
  printlnCopyEnvSnippetLine(`PGRST_JWT_SECRET=${secrets.pgrstJwtSecret}`);
  printlnCopyEnvSnippetLine(`POSTGRES_PASSWORD=${secrets.postgresPassword}`);
  printlnCopyEnvSnippetLine(
    `POSTGRES_CONTAINER_HOST=${secrets.postgresContainerHost}`,
  );
  console.log();
  for (const line of secrets.note.match(/.{1,76}/g) ?? [secrets.note]) {
    hintLine(line);
  }
  console.log();
}

export async function cmdCreate(
  name: string,
  options: { noSupabaseRestPath?: boolean; hash?: string; mode?: CreateProjectMode },
): Promise<void> {
  if (options.hash?.trim()) {
    console.log(
      chalk.dim(
        "Note: --hash is ignored for remote create; the control plane allocates a unique 7-hex id.",
      ),
    );
  }
  const client = getApiClient();
  console.log(chalk.blue("Creating project…"));
  const spin = ora("POST /api/cli/v1/create…").start();
  try {
    const result = await client.createProject({
      name,
      stripSupabaseRestPrefix: options.noSupabaseRestPath !== true,
      ...(options.mode ? { mode: options.mode } : {}),
    });
    spin.succeed("Created");
    printProjectSummaryCard(result, name);
  } catch (e) {
    spin.fail("Failed");
    throw e;
  }
}
