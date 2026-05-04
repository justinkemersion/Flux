#!/bin/bash
# Restart the Flux control plane (dashboard) without rebuilding images.
# Delegates to deploy.sh with FLUX_DEPLOY_RESTART_ONLY=1.
#
# Same env vars as deploy.sh; see that file for options.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export FLUX_DEPLOY_RESTART_ONLY=1
exec bash "$SCRIPT_DIR/deploy.sh" "$@"
