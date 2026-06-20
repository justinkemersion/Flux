import { type Command } from "commander";
import { cmdGauntletRun } from "../gauntlet";
import { cmdGauntletInspectSchema } from "../gauntlet-inspect-schema";
import { cmdGauntletMatrix } from "../gauntlet-matrix";
import { cliAction } from "./shared";

export function registerGauntletCommands(program: Command): void {
  const gauntlet = program
    .command("gauntlet")
    .description(
      "Repeatable end-to-end audit runner (disposable project, schema, API, backup, cleanup)",
    );

  const runCmd = gauntlet
    .command("run")
    .description(
      "Run gauntlet cycle: create project, push schema, probe API, verify backup, cleanup",
    )
    .option(
      "--mode <mode>",
      "Provisioning mode: v1_dedicated (default) or v2_shared",
      "v1_dedicated",
    )
    .option("--runs <number>", "Number of sequential gauntlet runs", "1")
    .option(
      "--keep-failed",
      "Keep failed projects alive for inspection (skip cleanup)",
      false,
    )
    .option(
      "--report-dir <path>",
      "Directory for run reports (default: reports/gauntlet)",
    )
    .option(
      "--prefix <slug-prefix>",
      "Disposable project name prefix (default: gauntlet)",
    )
    .option("--skip-backup", "Skip backup_create and backup_verify stages", false)
    .option("--json", "Print final JSON summary to stdout", false);

  runCmd.action(
    cliAction(async () => {
      const opts = runCmd.opts<{
        mode?: string;
        runs?: string;
        keepFailed?: boolean;
        reportDir?: string;
        prefix?: string;
        skipBackup?: boolean;
        json?: boolean;
      }>();
      await cmdGauntletRun({
        ...(opts.mode !== undefined ? { mode: opts.mode } : {}),
        ...(opts.runs !== undefined ? { runs: opts.runs } : {}),
        ...(opts.keepFailed !== undefined ? { keepFailed: opts.keepFailed } : {}),
        ...(opts.reportDir !== undefined ? { reportDir: opts.reportDir } : {}),
        ...(opts.prefix !== undefined ? { prefix: opts.prefix } : {}),
        ...(opts.skipBackup !== undefined ? { skipBackup: opts.skipBackup } : {}),
        ...(opts.json !== undefined ? { json: opts.json } : {}),
      });
    }),
  );

  const matrixCmd = gauntlet
    .command("matrix")
    .description(
      "Ring 2: CLI Matrix Lite — operator behavior scenarios (v1_dedicated only)",
    )
    .option("--mode <mode>", "Must be v1_dedicated", "v1_dedicated")
    .option(
      "--scenario <name>",
      "Run a single scenario (default: all Ring 2 scenarios)",
    )
    .option(
      "--keep-failed",
      "Keep failed scenario projects alive for inspection",
      false,
    )
    .option(
      "--report-dir <path>",
      "Directory for matrix reports (default: reports/gauntlet)",
    )
    .option(
      "--prefix <slug-prefix>",
      "Disposable project name prefix (default: gauntlet)",
    )
    .option("--json", "Print final JSON summary to stdout", false);

  matrixCmd.action(
    cliAction(async () => {
      const opts = matrixCmd.opts<{
        mode?: string;
        scenario?: string;
        keepFailed?: boolean;
        reportDir?: string;
        prefix?: string;
        json?: boolean;
      }>();
      await cmdGauntletMatrix({
        ...(opts.mode !== undefined ? { mode: opts.mode } : {}),
        ...(opts.scenario !== undefined ? { scenario: opts.scenario } : {}),
        ...(opts.keepFailed !== undefined ? { keepFailed: opts.keepFailed } : {}),
        ...(opts.reportDir !== undefined ? { reportDir: opts.reportDir } : {}),
        ...(opts.prefix !== undefined ? { prefix: opts.prefix } : {}),
        ...(opts.json !== undefined ? { json: opts.json } : {}),
      });
    }),
  );

  const inspectSchemaCmd = gauntlet
    .command("inspect-schema")
    .description(
      "Ring 3: Deep Postgres schema introspection for a v1_dedicated project",
    )
    .requiredOption("--project <slug>", "Project slug")
    .requiredOption("--hash <hash>", "Project hash")
    .option(
      "--report-dir <path>",
      "Directory for inspection artifacts (default: reports/gauntlet)",
    )
    .option("--json", "Print inspection JSON to stdout", false);

  inspectSchemaCmd.action(
    cliAction(async () => {
      const opts = inspectSchemaCmd.opts<{
        project?: string;
        hash?: string;
        reportDir?: string;
        json?: boolean;
      }>();
      await cmdGauntletInspectSchema({
        ...(opts.project !== undefined ? { project: opts.project } : {}),
        ...(opts.hash !== undefined ? { hash: opts.hash } : {}),
        ...(opts.reportDir !== undefined ? { reportDir: opts.reportDir } : {}),
        ...(opts.json !== undefined ? { json: opts.json } : {}),
      });
    }),
  );
}
