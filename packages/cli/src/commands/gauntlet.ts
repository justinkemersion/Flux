import { resolve } from "node:path";
import { runGauntlet } from "../gauntlet/runner";
import { parseGauntletRuns, resolveGauntletMode } from "../gauntlet/runner-options";
import type { GauntletRunOptions } from "../gauntlet/types";

export interface CmdGauntletRunOptions {
  mode?: string;
  runs?: string;
  keepFailed?: boolean;
  reportDir?: string;
  prefix?: string;
  skipBackup?: boolean;
  json?: boolean;
}

const DEFAULT_REPORT_DIR = "reports/gauntlet";

export async function cmdGauntletRun(
  options: CmdGauntletRunOptions,
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const gauntletOptions: GauntletRunOptions = {
    mode: resolveGauntletMode(options.mode),
    runs: parseGauntletRuns(options.runs ?? "1"),
    keepFailed: options.keepFailed === true,
    reportDir: resolve(process.cwd(), options.reportDir?.trim() || DEFAULT_REPORT_DIR),
    prefix: options.prefix?.trim() || "gauntlet",
    skipBackup: options.skipBackup === true,
    json: options.json === true,
  };

  const results = await runGauntlet({
    options: gauntletOptions,
    argv: ["flux", "gauntlet", "run", ...argv.filter((a) => a !== "gauntlet" && a !== "run")],
  });

  if (gauntletOptions.json) {
    console.log(JSON.stringify({ runs: results }, null, 2));
  }

  const anyFailed = results.some((r) => r.status === "fail");
  if (anyFailed) {
    process.exitCode = 1;
  }
}
