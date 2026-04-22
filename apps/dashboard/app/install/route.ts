import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Bash installer for:
 *   curl -sL https://flux.vsl-base.com/install | bash
 * Optional: FLUX_ORIGIN=https://... (dashboard origin, no /api)
 * Optional first arg: install directory (default: $HOME/.local/bin) — e.g. bash -s /usr/local/bin
 * Requires: curl, Node.js 20+ (the flux binary is an ESM script with a shebang)
 */
const FLUX_INSTALL_SCRIPT = [
  "#!/usr/bin/env bash",
  "#",
  "# Flux CLI installer",
  "#",
  "# Usage:",
  "#   curl -sL https://flux.vsl-base.com/install | bash",
  "#   FLUX_ORIGIN=https://your-host curl -sL \"$FLUX_ORIGIN/install\" | bash",
  "#   curl -sL https://flux.vsl-base.com/install | bash -s /path/to/bin",
  "#",
  "# Env: FLUX_ORIGIN — dashboard base URL (default: https://flux.vsl-base.com). No trailing /api.",
  "#",
  "set -euo pipefail",
  "if ! command -v curl >/dev/null 2>&1; then",
  "  echo \"Error: curl is required to download the CLI.\" >&2",
  "  exit 1",
  "fi",
  'FLUX_ORIGIN="${FLUX_ORIGIN:-https://flux.vsl-base.com}"',
  'TARGET="${1:-$HOME/.local/bin}"',
  'BIN="$TARGET/flux"',
  'echo "→ Installing Flux CLI to $BIN"',
  'mkdir -p "$TARGET"',
  'if ! curl -fsSL "$FLUX_ORIGIN/api/install/cli" -o "$BIN"; then',
  "  rm -f \"$BIN\" 2>/dev/null || true",
  "  echo \"Error: could not download the CLI. If the server returns HTTP 503, the CLI bundle is missing; build with pnpm --filter @flux/cli run build before the dashboard.\" >&2",
  "  exit 1",
  "fi",
  'chmod +x "$BIN"',
  "if ! command -v node >/dev/null 2>&1; then",
  "  echo \"Error: Node.js is required to run flux. Install 20+ from https://nodejs.org/\" >&2",
  "  exit 1",
  "fi",
  "NODE_MAJOR=$(node -e \"console.log(parseInt(process.versions.node.split('.')[0]||0, 10))\" 2>/dev/null) || NODE_MAJOR=0",
  "if [ \"${NODE_MAJOR:-0}\" -lt 20 ] 2>/dev/null; then",
  "  V=$(node --version 2>/dev/null || echo \"unknown\")",
  "  echo \"Error: Node.js 20+ is required to run flux (found: $V).\" >&2",
  "  exit 1",
  "fi",
  "echo '→ Set API base and a key (Dashboard → API keys), then:'",
  'printf "  export FLUX_API_BASE=%s/api\\n" "$FLUX_ORIGIN"',
  'echo "  export FLUX_API_TOKEN=\\"flx_live_...\\""',
  'echo "  flux list"',
].join("\n");

/**
 * GET /install
 */
export function GET() {
  return new NextResponse(FLUX_INSTALL_SCRIPT, {
    status: 200,
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=60",
    },
  });
}
