import chalk from "chalk";
import { loadConfig, type FluxConfig } from "../config";

export type CliRole = "admin" | "operator";

function parseCsvEnv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function verboseOverride(): boolean {
  const v = process.env.FLUX_CLI_VERBOSE?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Effective CLI audience: admins see hints; operators get a quieter terminal. */
export function resolveCliRole(profile?: FluxConfig["profile"]): CliRole {
  if (verboseOverride()) {
    return "admin";
  }
  if (profile?.cliRole === "admin") {
    return "admin";
  }

  const localAdmins = new Set(
    parseCsvEnv(process.env.FLUX_CLI_ADMIN_EMAILS).map((e) => e.toLowerCase()),
  );
  const user = profile?.user?.trim().toLowerCase();
  if (user && localAdmins.has(user)) {
    return "admin";
  }

  return "operator";
}

export function isCliAdmin(profile?: FluxConfig["profile"]): boolean {
  return resolveCliRole(profile) === "admin";
}

/** Suppress npm/node nag output for operators (admins opt in via role or FLUX_CLI_VERBOSE). */
export function configureCliProcessForAudience(): void {
  const profile = loadConfig()?.profile;
  if (isCliAdmin(profile)) {
    return;
  }
  process.env.npm_config_update_notifier ??= "false";
  process.env.NODE_NO_WARNINGS ??= "1";
}

export function cliHint(message: string, profile?: FluxConfig["profile"]): void {
  if (isCliAdmin(profile ?? loadConfig()?.profile)) {
    console.log(message);
  }
}

export function cliDimHint(message: string, profile?: FluxConfig["profile"]): void {
  if (isCliAdmin(profile ?? loadConfig()?.profile)) {
    console.log(chalk.dim(message));
  }
}

export function cliWarn(message: string, profile?: FluxConfig["profile"]): void {
  if (isCliAdmin(profile ?? loadConfig()?.profile)) {
    console.log(chalk.yellow(message));
  }
}
