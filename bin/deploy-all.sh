#!/bin/bash
# Orchestrated production deploy for Flux:
#   1) v2 shared data plane
#   2) node gateway
#   3) dashboard / control plane
#
# Why this order:
# - Data plane first so PostgREST/PgBouncer are ready.
# - Gateway second so routing points to healthy upstreams.
# - Dashboard last so user-facing control plane comes up after infra is healthy.
#
# Supported env flags:
#   FLUX_DEPLOY_GIT_SYNC=1       Run one `git pull --ff-only` before all stages.
#   FLUX_DEPLOY_PRUNE_BUILDER=1  Forwarded to child scripts (builder cache prune).
#   FLUX_ENV=prod                Optional label used in logs.
#   FLUX_DEPLOY_CONTINUE_ON_WARN=1  Continue if a stage exits non-zero (default: fail fast).
#
# Notes:
# - Child scripts already run `docker image prune -f` by default.
# - We intentionally keep FLUX_DEPLOY_PRUNE_BUILDER default OFF because it slows
#   subsequent builds significantly; enable it when disk pressure warrants it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

ENV_LABEL="${FLUX_ENV:-unknown}"
CONTINUE_ON_WARN="${FLUX_DEPLOY_CONTINUE_ON_WARN:-0}"

echo "--- Flux Deploy All: Initializing ---"
echo "  repo: $REPO_ROOT"
echo "  env: ${ENV_LABEL}"
echo "  prune_builder: ${FLUX_DEPLOY_PRUNE_BUILDER:-0}"
echo "  git_sync: ${FLUX_DEPLOY_GIT_SYNC:-0}"

if [[ "${FLUX_DEPLOY_GIT_SYNC:-}" == "1" ]]; then
  echo "--- Flux Deploy All: Git sync (ff-only) ---"
  if [[ ! -d "$REPO_ROOT/.git" ]]; then
    echo "  ERROR: not a git checkout; cannot run ff-only sync." >&2
    exit 1
  fi
  git -C "$REPO_ROOT" pull --ff-only
fi

run_stage() {
  local name="$1"
  local script="$2"

  echo ""
  echo "=== Stage: ${name} ==="

  # Important: we force child git sync off because we already did a single
  # optional pull above. This prevents drift between stages.
  if FLUX_DEPLOY_GIT_SYNC=0 "$script"; then
    echo "=== Stage OK: ${name} ==="
    return 0
  fi

  local code=$?
  echo "=== Stage FAILED (${code}): ${name} ===" >&2
  if [[ "$CONTINUE_ON_WARN" == "1" ]]; then
    echo "  WARN: continuing because FLUX_DEPLOY_CONTINUE_ON_WARN=1" >&2
    return 0
  fi
  return "$code"
}

run_stage "v2 shared data plane" "$SCRIPT_DIR/deploy-v2-shared.sh"
run_stage "gateway" "$SCRIPT_DIR/deploy-gateway.sh"
run_stage "dashboard control plane" "$SCRIPT_DIR/deploy.sh"

echo ""
echo "--- Flux Deploy All: Complete ---"
echo "Recommended quick checks:"
echo "  curl -fsS http://127.0.0.1:4000/health && echo"
echo "  curl -fsS http://127.0.0.1:4000/health/deep && echo"
echo "  docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' | grep -E 'flux-(web|node-gateway|postgrest-pool|pgbouncer|postgres-v2)' || true"
