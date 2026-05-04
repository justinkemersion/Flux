import { NextResponse } from "next/server";

export const runtime = "nodejs";

const CLI_URL = "https://flux.vsl-base.com/api/install/cli";
const FLUX_CONTEXT = "https://flux.vsl-base.com";
const DOCS_URL = "https://flux.vsl-base.com/docs";

const FLUX_INSTALL_SCRIPT = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  "# ANSI: emerald=success, amber=warn, zinc=meta, dim=secondary",
  "EM='\\033[38;2;52;211;153m'",
  "AM='\\033[38;2;245;158;11m'",
  "ZN='\\033[38;2;161;161;170m'",
  "ZK='\\033[38;2;82;82;91m'",
  "DI='\\033[2m'",
  "RS='\\033[0m'",
  "",
  "echo -e \"${DI}--- Flux Synchronization ---${RS}\"",
  "echo -e \"${ZK}# environment audit${RS}\"",
  "",
  'INSTALL_DIR="${1:-$HOME/.local/bin}"',
  'BIN="$INSTALL_DIR/flux"',
  "",
  "if command -v node >/dev/null 2>&1; then",
  "  _nv=$(node -v 2>/dev/null || echo \"unknown\")",
  "  echo -e \"  ${EM}Node.js ${_nv} detected.${RS}\"",
  "  _mj=$(node -e \"console.log(parseInt(process.versions.node.split('.')[0]||0, 10))\" 2>/dev/null) || _mj=0",
  "  if [ \"${_mj:-0}\" -lt 20 ] 2>/dev/null; then",
  "    echo -e \"  ${AM}! Node 20+ required for the Flux CLI (current: ${_nv}).${RS}\"",
  "  fi",
  "  unset _mj",
  "else",
  "  echo -e \"  ${AM}! node not found in PATH — install Node.js 20+ to run flux.${RS}\"",
  "fi",
  "unset _nv",
  "",
  "if [[ \":$PATH:\" == *\":$INSTALL_DIR:\"* ]]; then",
  "  echo -e \"  ${ZN}PATH Status${RS}  ${EM}PRESENT${RS}  ${DI}($INSTALL_DIR)${RS}\"",
  "else",
  "  echo -e \"  ${ZN}PATH Status${RS}  ${AM}ABSENT${RS}  ${DI}($INSTALL_DIR not on PATH)${RS}\"",
  "fi",
  "echo",
  "echo -e \"${ZK}# install${RS}\"",
  "command -v curl >/dev/null 2>&1 || { echo -e \"${AM}curl is required${RS}\" >&2; exit 1; }",
  'mkdir -p "$INSTALL_DIR"',
  `curl -fsSL ${JSON.stringify(CLI_URL)} -o "$BIN"`,
  'chmod +x "$BIN"',
  "echo -e \"${EM}  ✓${RS}  binary written + executable\"",
  "echo",
  "echo -e \"${ZK}┌ success report${RS}\"",
  'printf "  ${ZN}%-14s${RS}  ${EM}%s${RS}\\n" "Binary" "$BIN"',
  `printf "  \${ZN}%-14s\${RS}  \${DI}%s\${RS}\\n" "Context" "${FLUX_CONTEXT}"`,
  'printf "  ${ZN}%-14s${RS}  ${EM}%s${RS}\\n" "Status" "Synchronized"',
  "echo -e \"${ZK}└${RS}\"",
  "echo",
  "if [[ \":$PATH:\" != *\":$INSTALL_DIR:\"* ]]; then",
  "  echo -e \"${AM}!${RS} ${DI}Add:${RS}\"",
  "  echo -e \"     ${DI}export PATH=\\\"$INSTALL_DIR:\\$PATH\\\"${RS}\"",
  "fi",
  "echo -e \"${ZK}# first flight${RS}\"",
  "echo -e \"  ${ZN}flux login${RS}\"",
  "echo -e \"  ${ZN}flux create <project>${RS}\"",
  "echo -e \"  ${ZN}flux --help${RS}\"",
  "echo",
  `echo -e \"\${DI}docs: ${DOCS_URL}\${RS}\"`,
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
