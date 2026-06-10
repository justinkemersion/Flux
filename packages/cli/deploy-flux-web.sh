#!/bin/bash
# Remote-only flux-web deploy (legacy entrypoint).
# Prefer the full workflow: ../../bin/launch-web.sh --commit "..." from your laptop.
#
# Equivalent to: bin/launch-web.sh --remote-only [--force-sync]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

exec bash "$REPO_ROOT/bin/launch-web.sh" --remote-only --force-sync "$@"
