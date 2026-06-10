#!/usr/bin/env bash
# End-to-end launch for flux-web (https://flux.vsl-base.com).
#
# Typical flow from your laptop:
#   1. Preflight (optional): typecheck + dashboard production build
#   2. Git: commit (optional) → push → optional annotated tag
#   3. Env: optional rsync of whitelisted .env files (see bin/sync-env-remote.sh)
#   4. Remote: fetch + sync checkout → bin/deploy-web.sh on the server
#
# Usage:
#   ./bin/launch-web.sh --commit "feat: apps-first landing page"
#   ./bin/launch-web.sh --commit "fix: copy" --tag web-2026.06.10
#   ./bin/launch-web.sh --sync-env-apply          # push + sync env + deploy
#   ./bin/launch-web.sh --dry-run --commit "..."  # show plan only
#   ./bin/launch-web.sh --remote-only             # server sync + deploy (no local git)
#   ./bin/launch-web.sh --skip-checks --remote-only
#
# Environment (override defaults without editing this file):
#   FLUX_LAUNCH_REMOTE      SSH target (default: root@178.104.205.138)
#   FLUX_LAUNCH_APP_DIR     Remote repo root (default: /srv/platform/flux)
#   FLUX_LAUNCH_BRANCH      Branch to deploy (default: main)
#
# See also:
#   bin/deploy-web.sh          — run on the server only (build + cycle flux-web)
#   bin/sync-env-remote.sh     — env file whitelist sync
#   bin/deploy-all.sh          — full stack (v2 + gateway + web) on the server
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

REMOTE="${FLUX_LAUNCH_REMOTE:-${REMOTE:-root@178.104.205.138}}"
APP_DIR="${FLUX_LAUNCH_APP_DIR:-${APP_DIR:-/srv/platform/flux}}"
BRANCH="${FLUX_LAUNCH_BRANCH:-${BRANCH:-main}}"
CHECK_URL="${FLUX_LAUNCH_CHECK_URL:-https://flux.vsl-base.com/}"

DRY_RUN=0
SKIP_CHECKS=0
SKIP_PUSH=0
REMOTE_ONLY=0
FORCE_SYNC=0
SYNC_ENV=0          # 0=skip, 1=dry-run, 2=apply
COMMIT_MSG=""
TAG=""

show_help() {
  sed -n '3,35p' "$0" | sed 's/^# *//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h | --help)
      show_help
      exit 0
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    --skip-checks)
      SKIP_CHECKS=1
      ;;
    --skip-push)
      SKIP_PUSH=1
      ;;
    --remote-only)
      REMOTE_ONLY=1
      SKIP_CHECKS=1
      SKIP_PUSH=1
      ;;
    --force-sync)
      FORCE_SYNC=1
      ;;
    --sync-env)
      SYNC_ENV=1
      ;;
    --sync-env-apply)
      SYNC_ENV=2
      ;;
    --commit)
      shift
      COMMIT_MSG="${1:-}"
      if [[ -z "$COMMIT_MSG" ]]; then
        echo "ERROR: --commit requires a message argument." >&2
        exit 1
      fi
      ;;
    --tag | --version)
      shift
      TAG="${1:-}"
      if [[ -z "$TAG" ]]; then
        echo "ERROR: --tag requires a tag name (e.g. web-2026.06.10 or v0.2.0)." >&2
        exit 1
      fi
      ;;
    *)
      echo "Unknown argument: $1 (try --help)" >&2
      exit 1
      ;;
  esac
  shift
done

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "  [dry-run] $*"
  else
    "$@"
  fi
}

ssh_remote() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "  [dry-run] ssh -A $REMOTE $*"
  else
    ssh -A "$REMOTE" "$@"
  fi
}

require_git_repo() {
  if [[ ! -d "$REPO_ROOT/.git" ]]; then
    echo "ERROR: not a git checkout: $REPO_ROOT" >&2
    exit 1
  fi
}

current_branch() {
  git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD
}

preflight_local() {
  if [[ "$REMOTE_ONLY" -eq 1 || "$SKIP_CHECKS" -eq 1 ]]; then
    return 0
  fi

  echo "--- Launch: Preflight checks ---"
  run pnpm typecheck
  run pnpm --filter dashboard run build
  echo "  preflight: OK"
}

git_commit_if_requested() {
  if [[ -z "$COMMIT_MSG" ]]; then
    return 0
  fi

  echo "--- Launch: Commit ---"
  if [[ -z "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
    echo "  nothing to commit (working tree clean)"
    return 0
  fi

  run git -C "$REPO_ROOT" add -A
  run git -C "$REPO_ROOT" commit -m "$COMMIT_MSG"
}

git_ensure_clean_or_commit() {
  if [[ "$REMOTE_ONLY" -eq 1 ]]; then
    return 0
  fi
  if [[ -n "$COMMIT_MSG" ]]; then
    return 0
  fi
  if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
    echo "ERROR: uncommitted changes. Commit first or pass --commit \"message\"." >&2
    git -C "$REPO_ROOT" status --short >&2
    exit 1
  fi
}

git_tag_if_requested() {
  if [[ -z "$TAG" ]]; then
    return 0
  fi

  echo "--- Launch: Tag $TAG ---"
  if git -C "$REPO_ROOT" rev-parse "$TAG" >/dev/null 2>&1; then
    echo "ERROR: tag already exists locally: $TAG" >&2
    exit 1
  fi
  local sha msg
  sha="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
  msg="flux-web launch ${TAG} @ ${sha}"
  run git -C "$REPO_ROOT" tag -a "$TAG" -m "$msg"
}

git_push() {
  if [[ "$REMOTE_ONLY" -eq 1 || "$SKIP_PUSH" -eq 1 ]]; then
    return 0
  fi

  echo "--- Launch: Push ---"
  local local_branch
  local_branch="$(current_branch)"
  if [[ "$local_branch" != "$BRANCH" ]]; then
    echo "  WARN: local branch is '${local_branch}', deploying '${BRANCH}'."
    echo "        Push explicitly targets origin/${BRANCH}."
  fi

  run git -C "$REPO_ROOT" push origin "HEAD:${BRANCH}"
  if [[ -n "$TAG" ]]; then
    run git -C "$REPO_ROOT" push origin "$TAG"
  fi
}

sync_env_files() {
  if [[ "$SYNC_ENV" -eq 0 ]]; then
    return 0
  fi

  echo "--- Launch: Sync environment files ---"
  if [[ "$SYNC_ENV" -eq 1 ]]; then
    run "$SCRIPT_DIR/sync-env-remote.sh" "$REMOTE"
  else
    run "$SCRIPT_DIR/sync-env-remote.sh" "$REMOTE" --apply
  fi
}

remote_require_env() {
  echo "--- Launch: Verify remote .env ---"
  ssh_remote "test -f $APP_DIR/docker/web/.env" || {
    echo "ERROR: $APP_DIR/docker/web/.env missing on $REMOTE." >&2
    echo "       Copy docker/web/.env.example on the server, or run:" >&2
    echo "       ./bin/sync-env-remote.sh $REMOTE --apply" >&2
    exit 1
  }
}

remote_sync_repo() {
  echo "--- Launch: Remote git sync ($APP_DIR @ origin/$BRANCH) ---"
  if [[ "$FORCE_SYNC" -eq 1 || "$REMOTE_ONLY" -eq 1 ]]; then
    ssh_remote "cd $APP_DIR && git fetch --all --prune && git checkout $BRANCH && git reset --hard origin/$BRANCH"
  else
    ssh_remote "cd $APP_DIR && git fetch --all --prune && git checkout $BRANCH && git pull --ff-only origin $BRANCH"
  fi
}

remote_deploy() {
  echo "--- Launch: Remote deploy (bin/deploy-web.sh) ---"
  ssh_remote "cd $APP_DIR && bash bin/deploy-web.sh"
}

remote_version_info() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "  [dry-run] would print remote git SHA"
    return 0
  fi
  local sha tag_desc
  sha="$(ssh -A "$REMOTE" "cd $APP_DIR && git rev-parse --short HEAD" 2>/dev/null || echo unknown)"
  tag_desc="$(ssh -A "$REMOTE" "cd $APP_DIR && git describe --tags --always" 2>/dev/null || echo unknown)"
  echo "  deployed_sha: $sha"
  echo "  deployed_ref: $tag_desc"
}

post_deploy_smoke() {
  echo "--- Launch: Smoke check ---"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "  [dry-run] curl -fsS $CHECK_URL"
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "  skip: curl not available locally"
    return 0
  fi
  local code
  code="$(curl -sS -o /dev/null -w "%{http_code}" "$CHECK_URL" || echo "000")"
  if [[ "$code" == "200" || "$code" == "301" || "$code" == "302" || "$code" == "307" || "$code" == "308" ]]; then
    echo "  smoke: OK ($CHECK_URL → HTTP $code)"
  else
    echo "  WARN: smoke check returned HTTP $code for $CHECK_URL" >&2
    echo "        Inspect: ssh $REMOTE 'docker logs --tail 80 flux-web'" >&2
  fi
}

# --- main ---

echo "--- Flux Launch (flux-web): Initializing ---"
echo "  local_repo: $REPO_ROOT"
echo "  remote:     $REMOTE"
echo "  app_dir:    $APP_DIR"
echo "  branch:     $BRANCH"
echo "  dry_run:    $DRY_RUN"
echo "  remote_only: $REMOTE_ONLY"
echo "  sync_env:   $SYNC_ENV (0=skip 1=dry-run 2=apply)"
[[ -n "$TAG" ]] && echo "  tag:        $TAG"

if [[ "$REMOTE_ONLY" -eq 0 ]]; then
  require_git_repo
  preflight_local
  git_commit_if_requested
  git_ensure_clean_or_commit
  git_tag_if_requested
  git_push
fi

sync_env_files
remote_require_env
remote_sync_repo
remote_deploy

echo ""
echo "--- Flux Launch: Complete ---"
remote_version_info
post_deploy_smoke
echo "  url:  $CHECK_URL"
echo "  logs: ssh $REMOTE 'docker logs -f flux-web'"
