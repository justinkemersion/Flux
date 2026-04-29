import stripAnsi from "strip-ansi";
import { getVisibleLength } from "./utils/terminal.js";

export { getVisibleLength } from "./utils/terminal.js";

/** Same as {@link getVisibleLength} (legacy import path). */
export function visibleLength(s: string): number {
  return getVisibleLength(s);
}

/** SGR and other ANSI escapes — strip for terminal column / border width math. */
export function stripAnsiSgr(s: string): string {
  return stripAnsi(s);
}
