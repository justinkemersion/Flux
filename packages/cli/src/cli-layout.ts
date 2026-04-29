import chalk from "chalk";
import { getVisibleLength } from "./utils/terminal.js";

/**
 * Flux CLI terminal layout: flush-left for copy-paste (.env, keys, URLs, shell);
 * {@link B}-indented dim lines for hints under a heading (bullet-style hierarchy).
 */
export const B = "  ";

export function sectionBanner(title: string): void {
  console.log();
  console.log(chalk.bold.cyan(title));
  console.log(chalk.dim("─".repeat(Math.max(title.length, 24))));
}

export function labelDim(text: string): void {
  console.log(chalk.dim(text));
}

export function hintLine(text: string): void {
  console.log(chalk.dim(`${B}${text}`));
}

/** `.env` / assignment line: column 0 (no leading spaces) for safe copy-paste. */
export function printlnCopyPlain(line: string): void {
  console.log(line.trimStart());
}

/**
 * App `.env` snippet line at column 0: comments dim; `KEY=value` with token colors.
 */
export function printlnCopyEnvSnippetLine(line: string): void {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("#")) {
    console.log(chalk.dim(trimmed));
    return;
  }
  const eq = line.indexOf("=");
  if (eq > 0) {
    const k = line.slice(0, eq).trimStart();
    const v = line.slice(eq + 1);
    const secretish =
      k.toUpperCase() === "FLUX_GATEWAY_JWT_SECRET" ||
      k.toUpperCase() === "PGRST_JWT_SECRET" ||
      k.toUpperCase() === "POSTGRES_PASSWORD";
    const valStyled = secretish ? chalk.green(v) : chalk.white(v);
    console.log(`${chalk.cyan(k)}${chalk.dim("=")}${valStyled}`);
  } else {
    console.log(trimmed);
  }
}

export function boxTop(innerWidth: number, margin = ""): void {
  console.log(margin + chalk.dim(`┌${"─".repeat(innerWidth)}┐`));
}

export function boxSep(innerWidth: number, margin = ""): void {
  console.log(margin + chalk.dim(`├${"─".repeat(innerWidth)}┤`));
}

export function boxBottom(innerWidth: number, margin = ""): void {
  console.log(margin + chalk.dim(`└${"─".repeat(innerWidth)}┘`));
}

/** Inner row between `│` borders; `styled` must match {@link getVisibleLength} for padding. */
export function boxLine(
  innerWidth: number,
  styled: string,
  margin = "",
): void {
  const pad = " ".repeat(Math.max(0, innerWidth - getVisibleLength(styled)));
  console.log(
    `${margin}${chalk.dim("│ ")}${styled}${pad}${chalk.dim("│")}`,
  );
}
