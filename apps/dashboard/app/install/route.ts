import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Bash installer for one-liner: `curl -sL https://flux.vsl-base.com/install | bash` */
const FLUX_INSTALL_SCRIPT = [
  "#!/usr/bin/env bash",
  "# Flux CLI — https://flux.vsl-base.com",
  "set -euo pipefail",
  'FLUX_ORIGIN="${FLUX_ORIGIN:-https://flux.vsl-base.com}"',
  'TARGET="${1:-$HOME/.local/bin}"',
  'BIN="$TARGET/flux"',
  'echo "→ Installing Flux CLI to $BIN"',
  'mkdir -p "$TARGET"',
  'curl -fsSL "$FLUX_ORIGIN/api/install/cli" -o "$BIN"',
  'chmod +x "$BIN"',
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
