import chalk from "chalk";
import { getVisibleLength } from "./utils/terminal.js";

/**
 * Flux CLI helpers: two-space {@link B} for banners/sections; boxed rows use
 * {@link getVisibleLength} for padding. Env snippet printer supports optional indent
 * for nested lines while create keeps copy-paste blocks at column 0 when indent is "".
 */
export const B = "  ";

export function sectionBanner(title: string): void {
  console.log();
  console.log(chalk.bold.cyan(`${B}${title}`));
  console.log(chalk.dim(B + "─".repeat(Math.max(title.length, 24))));
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
 * Dashes between `┌`/`├`/`└` and `┐`/`┤`/`┘` when body rows use `│ ` (pipe + space)
 * before the inner cell area — total width matches `│ ` + inner + `│`.
 */
function boxHorizontalDashCount(innerContentWidth: number): number {
  return innerContentWidth + 1;
}

/**
 * App `.env` snippet: comments dim; `KEY=value` with token colors.
 * @param indent optional prefix (e.g. four spaces for nested reference lines); use `""` for copy-paste blocks.
 */
export function printlnCopyEnvSnippetLine(line: string, indent = ""): void {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("#")) {
    console.log(indent + chalk.dim(trimmed));
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
    console.log(
      `${indent}${chalk.cyan(k)}${chalk.dim("=")}${valStyled}`,
    );
  } else {
    console.log(indent + trimmed);
  }
}

export function boxTop(innerWidth: number, margin = ""): void {
  const d = boxHorizontalDashCount(innerWidth);
  console.log(margin + chalk.dim(`┌${"─".repeat(d)}┐`));
}

export function boxSep(innerWidth: number, margin = ""): void {
  const d = boxHorizontalDashCount(innerWidth);
  console.log(margin + chalk.dim(`├${"─".repeat(d)}┤`));
}

export function boxBottom(innerWidth: number, margin = ""): void {
  const d = boxHorizontalDashCount(innerWidth);
  console.log(margin + chalk.dim(`└${"─".repeat(d)}┘`));
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
