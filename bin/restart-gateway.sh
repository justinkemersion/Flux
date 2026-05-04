#!/bin/bash
# Restart the Flux Node gateway without rebuilding images.
# Delegates to deploy-gateway.sh with FLUX_DEPLOY_RESTART_ONLY=1.
#
# Same env vars as deploy-gateway.sh; see that file for options.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export FLUX_DEPLOY_RESTART_ONLY=1
exec bash "$SCRIPT_DIR/deploy-gateway.sh" "$@"
