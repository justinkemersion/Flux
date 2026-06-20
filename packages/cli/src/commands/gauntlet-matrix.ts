import { resolve } from "node:path";
import { runGauntletMatrix } from "../gauntlet/matrix-runner";
import {
  assertMatrixModeV1,
  type MatrixRunOptions,
  type MatrixScenarioName,
} from "../gauntlet/matrix-types";

export interface CmdGauntletMatrixOptions {
  mode?: string;
  scenario?: string;
  keepFailed?: boolean;
  reportDir?: string;
  prefix?: string;
  json?: boolean;
}

const DEFAULT_REPORT_DIR = "reports/gauntlet";

export async function cmdGauntletMatrix(
  options: CmdGauntletMatrixOptions,
): Promise<void> {
  const mode = assertMatrixModeV1(options.mode);
  const matrixOptions: MatrixRunOptions = {
    mode,
    reportDir: resolve(
      process.cwd(),
      options.reportDir?.trim() || DEFAULT_REPORT_DIR,
    ),
    prefix: options.prefix?.trim() || "gauntlet",
    keepFailed: options.keepFailed === true,
    json: options.json === true,
    ...(options.scenario?.trim()
      ? { scenario: options.scenario.trim() as MatrixScenarioName }
      : {}),
  };

  const { results, summaryPath } = await runGauntletMatrix({
    options: matrixOptions,
    argv: ["flux", "gauntlet", "matrix"],
  });

  if (matrixOptions.json) {
    console.log(JSON.stringify({ summaryPath, results }, null, 2));
  }

  const anyFailed = results.some((r) => r.status === "fail");
  if (anyFailed) {
    process.exitCode = 1;
  }
}
