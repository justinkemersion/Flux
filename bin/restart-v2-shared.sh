#!/bin/bash
# Restart the Flux v2 shared data-plane stack without rebuilding images.
# Delegates to deploy-v2-shared.sh with FLUX_DEPLOY_RESTART_ONLY=1.
#
# Same env vars and safety checks as deploy-v2-shared.sh; see that file for options.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export FLUX_DEPLOY_RESTART_ONLY=1
exec bash "$SCRIPT_DIR/deploy-v2-shared.sh" "$@"
