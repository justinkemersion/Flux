const VERSION_TOKENS = new Set(["-V", "--version", "version"]);

/**
 * Recognize `flux version`, `flux -V`, `flux --version`, each optionally with `--json`.
 * Handled ahead of Commander so provenance is printable even when subcommand wiring
 * or project config would otherwise fail.
 */
export function parseVersionInvocation(
  argv: readonly string[],
): { json: boolean } | null {
  const first = argv[0];
  if (first == null || !VERSION_TOKENS.has(first)) return null;
  if (argv.length === 1) return { json: false };
  if (argv.length === 2 && argv[1] === "--json") return { json: true };
  return null;
}
