import { NextResponse } from "next/server";

export const runtime = "nodejs";

const CLI_URL = "https://flux.vsl-base.com/api/install/cli";

const FLUX_INSTALL_SCRIPT = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  "echo '--- Flux Synchronization ---'",
  'INSTALL_DIR="${1:-$HOME/.local/bin}"',
  'BIN="$INSTALL_DIR/flux"',
  "command -v curl >/dev/null 2>&1 || { echo 'curl is required' >&2; exit 1; }",
  'mkdir -p "$INSTALL_DIR"',
  `curl -fsSL ${JSON.stringify(CLI_URL)} -o "$BIN"`,
  'chmod +x "$BIN"',
  "if ! command -v node >/dev/null 2>&1; then",
  "  echo 'Warning: node not found. flux is an ESM CLI; use Node 20+.' >&2",
  "else",
  "  _mj=$(node -e \"console.log(parseInt(process.versions.node.split('.')[0]||0, 10))\" 2>/dev/null) || _mj=0",
  "  if [ \"${_mj:-0}\" -lt 20 ] 2>/dev/null; then",
  "    _v=$(node --version 2>/dev/null || echo unknown)",
  "    echo \"Warning: Node 20+ expected (current: $_v).\" >&2",
  "  fi",
  "  unset _mj _v",
  "fi",
  "if [[ \":$PATH:\" != *\":$INSTALL_DIR:\"* ]]; then",
  "  echo 'PATH does not include this install dir. Add:'",
  "  echo \"  export PATH=\\\"\$INSTALL_DIR:\\$PATH\\\"\"",
  "fi",
  "",
].join("\n");

export function GET() {
  return new NextResponse(FLUX_INSTALL_SCRIPT, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=60",
    },
  });
}
