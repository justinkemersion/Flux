import { buildFluxAppDotEnvSnippet } from "@flux/core/standalone";
import chalk from "chalk";
import ora from "ora";
import type { CreateProjectMode, CreateProjectResult } from "../api-client";
import { getApiClient } from "../api-client";
import { visibleLength } from "../ansi";

function printProjectSummaryCard(
  result: CreateProjectResult,
  nameArg: string,
): void {
  const { summary, secrets } = result;
  const inner = 56;
  const hr = chalk.dim("─".repeat(inner));
  const row = (key: string, val: string): void => {
    const keyPlain = key.padEnd(16);
    const keyStyled = chalk.yellow(keyPlain);
    const maxVal = Math.max(0, inner - visibleLength(keyStyled));
    let valPlain = val;
    if (valPlain.length > maxVal) {
      valPlain = `${valPlain.slice(0, Math.max(0, maxVal - 1))}…`;
    }
    const valStyled = chalk.white(valPlain);
    const used = visibleLength(keyStyled) + visibleLength(valStyled);
    const pad = " ".repeat(Math.max(0, inner - used));
    console.log(
      `${chalk.dim("  │ ")}${keyStyled}${valStyled}${pad}${chalk.dim("│")}`,
    );
  };

  console.log();
  console.log(
    `${chalk.dim("  ")}${chalk.bold("Created")} ${chalk.bold.cyan(summary.slug)} ${chalk.bold.yellow(`#${summary.hash}`)}`,
  );
  console.log(chalk.dim(`  name (input): ${nameArg}`));
  console.log();

  console.log(chalk.dim("  ┌") + hr + chalk.dim("┐"));
  const titleStyled = chalk.bold.cyan("PROJECT_SUMMARY");
  const titlePad = " ".repeat(Math.max(0, inner - visibleLength(titleStyled)));
  console.log(
    `${chalk.dim("  │ ")}${titleStyled}${chalk.dim(titlePad)}${chalk.dim("│")}`,
  );
  console.log(chalk.dim("  ├") + hr + chalk.dim("┤"));
  row("slug", summary.slug);
  row("hash", summary.hash);
  row("status", summary.status);
  console.log(chalk.dim("  └") + hr + chalk.dim("┘"));

  console.log();
  console.log(chalk.dim("  POSTGREST API"));
  console.log(chalk.white(`    ${summary.apiUrl}`));
  console.log();

  console.log(chalk.dim("  APP .ENV"));
  console.log(
    chalk.dim(
      "    Paste into .env or .env.local (or a new file). For `flux push`, add ./flux.json with the same slug and hash above.",
    ),
  );
  const snippet = buildFluxAppDotEnvSnippet(summary.apiUrl);
  for (const line of snippet.split("\n")) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("#")) {
      console.log(chalk.dim(`    ${line}`));
    } else {
      const eq = line.indexOf("=");
      if (eq > 0) {
        const left = line.slice(0, eq);
        const right = line.slice(eq + 1);
        console.log(
          `    ${chalk.cyan(left)}${chalk.dim("=")}${chalk.green(right)}`,
        );
      } else {
        console.log(`    ${line}`);
      }
    }
  }
  console.log();

  console.log(chalk.dim("  RUNTIME_CREDENTIALS"));
  console.log(`    PGRST_JWT_SECRET=${secrets.pgrstJwtSecret}`);
  console.log(`    POSTGRES_PASSWORD=${secrets.postgresPassword}`);
  console.log(`    POSTGRES_CONTAINER_HOST=${secrets.postgresContainerHost}`);
  console.log();
  for (const line of secrets.note.match(/.{1,76}/g) ?? [secrets.note]) {
    console.log(chalk.dim(`    ${line}`));
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
