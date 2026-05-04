#!/bin/bash
# Orchestrated production restart for Flux (no image rebuild):
#   1) v2 shared data plane
#   2) node gateway
#   3) dashboard / control plane
#
# Same ordering rationale as deploy-all.sh, but each stage runs
# `docker compose up -d --remove-orphans --no-build` only — no `build --pull`,
# no image or builder prune. Use when you need to recycle containers without
# pulling fresh base layers or rebuilding app images.
#
# Supported env flags:
#   FLUX_DEPLOY_GIT_SYNC=1       Run one `git pull --ff-only` before all stages.
#   FLUX_ENV=prod                Optional label used in logs.
#   FLUX_DEPLOY_CONTINUE_ON_WARN=1  Continue if a stage exits non-zero (default: fail fast).
#   FLUX_DOCS_STALE_DAYS=14      Warn if trajectory TODO doc is older than this many days.
#
# Child stages set FLUX_DEPLOY_RESTART_ONLY internally via restart-*.sh wrappers.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

ENV_LABEL="${FLUX_ENV:-unknown}"
CONTINUE_ON_WARN="${FLUX_DEPLOY_CONTINUE_ON_WARN:-0}"
DOCS_STALE_DAYS="${FLUX_DOCS_STALE_DAYS:-14}"
TRAJECTORY_DOC="docs/TRAJECTORY-TODO.md"

echo "--- Flux Restart All: Initializing ---"
echo "  repo: $REPO_ROOT"
echo "  env: ${ENV_LABEL}"
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
    echo "  WARN: docs freshness check skipped (no 'Last updated: `YYYY-MM-DD`' line in ${doc})." >&2
    return 0
  fi

  local updated_date
  updated_date="$(echo "$updated_line" | sed -E 's/.*`([0-9]{4}-[0-9]{2}-[0-9]{2})`.*/\1/')"

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
  echo "--- Flux Restart All: Git sync (ff-only) ---"
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

run_stage "v2 shared data plane" "$SCRIPT_DIR/restart-v2-shared.sh"
run_stage "gateway" "$SCRIPT_DIR/restart-gateway.sh"
run_stage "dashboard control plane" "$SCRIPT_DIR/restart-web.sh"

echo ""
echo "--- Flux Restart All: Complete ---"
echo "Recommended quick checks:"
echo "  curl -fsS http://127.0.0.1:4000/health && echo"
echo "  curl -fsS http://127.0.0.1:4000/health/deep && echo"
echo "  docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' | grep -E 'flux-(web|node-gateway|postgrest-pool|pgbouncer|postgres-v2)' || true"
