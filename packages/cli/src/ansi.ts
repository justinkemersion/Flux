/** SGR sequences (e.g. chalk) — strip for terminal column / border width math. */
const ANSI_SGR_RE = /\u001b\[[0-9;]*m/g;

export function stripAnsiSgr(s: string): string {
  return s.replace(ANSI_SGR_RE, "");
}

export function visibleLength(s: string): number {
  return stripAnsiSgr(s).length;
}
