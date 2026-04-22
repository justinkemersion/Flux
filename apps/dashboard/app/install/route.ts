import { NextResponse } from "next/server";

export const runtime = "nodejs";

const CLI_URL = "https://flux.vsl-base.com/api/install/cli";

const DOCS_URL = "https://flux.vsl-base.com/docs";

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
  'echo -e "\\033[0;32m✔\\033[0m Flux binary synchronized to $BIN"',
  'echo -e "\\033[0;32m✔\\033[0m Permissions established (755)"',
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
  "if [[ \":$PATH:\" == *\":$INSTALL_DIR:\"* ]]; then",
  '  echo -e "\\033[0;32m✔\\033[0m Binary is in active PATH."',
  "else",
  '  echo -e "\\033[0;33m! Warning:\\033[0m $INSTALL_DIR not in PATH."',
  "  echo 'Add to your shell profile, e.g.:'",
  "  echo \"  export PATH=\\\"\$INSTALL_DIR:\\$PATH\\\"\"",
  "fi",
  "echo",
  "echo -e \"\\033[1mNEXT STEPS:\\033[0m\"",
  'echo "  1. flux login           # Authenticate your terminal"',
  'echo "  2. flux create [name]   # Provision a new project"',
  'echo "  3. flux --help          # View the command reference"',
  "echo",
  `echo -e \"\\033[0;90mCodex Reference: ${DOCS_URL}\\033[0m\"`,
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
