import stripAnsi from "strip-ansi";

/** SGR and other ANSI escapes — strip for terminal column / border width math. */
export function stripAnsiSgr(s: string): string {
  return stripAnsi(s);
}

export function visibleLength(s: string): number {
  return stripAnsi(s).length;
}
