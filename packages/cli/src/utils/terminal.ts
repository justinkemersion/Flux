import stripAnsi from "strip-ansi";

/**
 * Visible character count for terminal layout (box borders, padding), ignoring SGR/ANSI escapes.
 */
export function getVisibleLength(str: string): number {
  return stripAnsi(str).length;
}
