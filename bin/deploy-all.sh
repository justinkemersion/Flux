#!/bin/bash
# Orchestrated production deploy for Flux (image build + restart).
# To recycle containers without rebuilding images, use bin/restart-all.sh instead.
#
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
#   FLUX_DOCS_STALE_DAYS=14      Warn if trajectory TODO doc is older than this many days.
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
DOCS_STALE_DAYS="${FLUX_DOCS_STALE_DAYS:-14}"
TRAJECTORY_DOC="docs/TRAJECTORY-TODO.md"

echo "--- Flux Deploy All: Initializing ---"
echo "  repo: $REPO_ROOT"
echo "  env: ${ENV_LABEL}"
echo "  prune_builder: ${FLUX_DEPLOY_PRUNE_BUILDER:-0}"
echo "  git_sync: ${FLUX_DEPLOY_GIT_SYNC:-0}"
echo "  docs_stale_days: ${DOCS_STALE_DAYS}"

check_docs_freshness() {
  local doc="$1"
  local max_age_days="$2"

  if [[ ! -f "$doc" ]]; then
    echo "  WARN: docs freshness check skipped (missing ${doc})." >&2
    return 0
  fi

  local updated_line
  updated_line="$(awk '/^-\s*Last updated:\s*`[0-9]{4}-[0-9]{2}-[0-9]{2}`/{print; exit}' "$doc")"
  if [[ -z "$updated_line" ]]; then
    echo "  WARN: docs freshness check skipped (no 'Last updated: \`YYYY-MM-DD\`' line in ${doc})." >&2
    return 0
  fi

  local updated_date
  updated_date="$(echo "$updated_line" | sed -E 's/.*`([0-9]{4}-[0-9]{2}-[0-9]{2})`.*/\1/')"

  # GNU date is expected on Linux production hosts.
  local updated_epoch now_epoch age_days
  if ! updated_epoch="$(date -d "$updated_date" +%s 2>/dev/null)"; then
    echo "  WARN: docs freshness check skipped (could not parse date '${updated_date}' from ${doc})." >&2
    return 0
  fi
  now_epoch="$(date +%s)"
  age_days="$(( (now_epoch - updated_epoch) / 86400 ))"

  if (( age_days > max_age_days )); then
    echo "  WARN: trajectory docs are stale (${age_days} days old; threshold ${max_age_days})." >&2
    echo "        Update ${doc} to reflect current deploy/test priorities." >&2
  else
    echo "  docs: ${doc} is fresh (${age_days} days old; threshold ${max_age_days})"
  fi
}

check_docs_freshness "$TRAJECTORY_DOC" "$DOCS_STALE_DAYS"

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
  else
    local code=$?
    echo "=== Stage FAILED (${code}): ${name} ===" >&2
    if [[ "$CONTINUE_ON_WARN" == "1" ]]; then
      echo "  WARN: continuing because FLUX_DEPLOY_CONTINUE_ON_WARN=1" >&2
      return 0
    fi
    return "$code"
  fi
}

run_stage "v2 shared data plane" "$SCRIPT_DIR/deploy-v2-shared.sh"
run_stage "gateway" "$SCRIPT_DIR/deploy-gateway.sh"
run_stage "dashboard control plane" "$SCRIPT_DIR/deploy-web.sh"

echo ""
echo "--- Flux Deploy All: Complete ---"
echo "Recommended quick checks:"
echo "  curl -fsS http://127.0.0.1:4000/health && echo"
echo "  curl -fsS http://127.0.0.1:4000/health/deep && echo"
echo "  docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' | grep -E 'flux-(web|node-gateway|postgrest-pool|pgbouncer|postgres-v2)' || true"
