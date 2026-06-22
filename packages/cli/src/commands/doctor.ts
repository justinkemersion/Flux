import chalk from "chalk";
import { getApiClient } from "../api-client.js";
import type { FluxJson } from "../flux-config.js";
import { resolveHash } from "../project-resolve.js";
import { B, sectionBanner } from "../cli-layout.js";
import type { DoctorCheck, DoctorReport } from "../api-client/doctor.js";

function statusIcon(status: DoctorCheck["status"]): string {
  if (status === "pass") return chalk.green("PASS");
  if (status === "warn") return chalk.yellow("WARN");
  return chalk.red("FAIL");
}

function printReport(report: DoctorReport): void {
  sectionBanner(`Flux Doctor: ${report.projectSlug}`);

  const wName = 22;
  for (const check of report.checks) {
    const icon = statusIcon(check.status);
    const name = check.name.padEnd(wName);
    console.log(`${B}${icon}  ${chalk.white(name)}${chalk.dim(check.detail)}`);
    if (check.remediation && check.status !== "pass") {
      console.log(`${B}      ${" ".repeat(wName)}${chalk.dim(`→ ${check.remediation}`)}`);
    }
  }

  console.log();

  const failCount = report.checks.filter((c) => c.status === "fail").length;
  const warnCount = report.checks.filter((c) => c.status === "warn").length;

  if (report.overallStatus === "pass") {
    console.log(`${B}${chalk.green("✓")} ${chalk.green.bold("Project is healthy.")}`);
  } else if (report.overallStatus === "warn") {
    console.log(
      `${B}${chalk.yellow("⚠")} ${chalk.white.bold("Project is usable")}${chalk.dim(` — ${String(warnCount)} warning${warnCount === 1 ? "" : "s"}`)}.`,
    );
  } else {
    console.log(
      `${B}${chalk.red("✗")} ${chalk.red.bold("Project has problems")}${chalk.dim(` — ${String(failCount)} failure${failCount === 1 ? "" : "s"}, ${String(warnCount)} warning${warnCount === 1 ? "" : "s"}`)}.`,
    );
  }
  console.log();
}

/**
 * flux doctor / flux project doctor
 * Exits non-zero only on hard FAIL checks.
 */
export async function cmdDoctor(
  _name: string | undefined,
  opts: { hash?: string },
  flux: FluxJson | null,
): Promise<void> {
  const hash = resolveHash(opts.hash, flux);
  const client = getApiClient();
  const report = await client.runDoctor(hash);
  printReport(report);
  if (report.overallStatus === "fail") {
    process.exit(1);
  }
}
