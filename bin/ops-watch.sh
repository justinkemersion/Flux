#!/usr/bin/env bash
# Error-only Docker/host watcher for a Flux production host.
# Prints nothing and exits 0 when healthy. Prints FAIL lines and exits 1
# when something is wrong. Does **not** send mail — flux-web's ops-watch
# tick reuses sendOpsAlert (FLUX_ALERT_EMAIL_* / FLUX_RESEND_API_KEY).
#
# Run on the server (canonical repo: /srv/platform/flux):
#   ./bin/ops-watch.sh
#
# Run from your laptop over SSH (same defaults as bin/ops-audit.sh):
#   ./bin/ops-watch.sh --remote
#   ./bin/ops-watch.sh --remote --json
#
# Exited-tenant filter (keep aligned with apps/dashboard/src/lib/ops-watch-classify.ts):
#   skip flux-backup-verify-*, flux-ops-watch-*, *-canary
#   skip exited flux-<7hex>-* with no catalog row (orphan / leftover test)
#   skip catalog lifecycle_state dormant|archived (sleep/archive)
#   skip catalog health_status=stopped (dashboard power-off / flux reap)
# Restarting / unhealthy still fail even for those rows.
#
# /srv/apps is not checked — there is no control-plane convention for
# expected compose projects under that tree.
#
# Env:
#   FLUX_OPS_WATCH_DISK_ALERT_PERCENT   default 90 (ops-audit high watermark)
#   FLUX_OPS_WATCH_LOG_MINUTES          default 15
#   FLUX_OPS_WATCH_LOG_CONTAINERS       comma list; default core services
#
set -euo pipefail

FLUX_SYNC_SSH_USER="${FLUX_SYNC_SSH_USER:-root}"
FLUX_SYNC_SSH_HOST="${FLUX_SYNC_SSH_HOST:-178.104.205.138}"
FLUX_SYNC_REMOTE="${FLUX_SYNC_REMOTE:-${FLUX_SYNC_SSH_USER}@${FLUX_SYNC_SSH_HOST}}"
FLUX_REMOTE_REPO_ROOT="${FLUX_REMOTE_REPO_ROOT:-/srv/platform/flux}"

FLUX_WEB_CONTAINER="${FLUX_WEB_CONTAINER:-flux-web}"
FLUX_TRAEFIK_CONTAINER="${FLUX_TRAEFIK_CONTAINER:-flux-gateway}"
FLUX_NODE_GATEWAY_CONTAINER="${FLUX_NODE_GATEWAY_CONTAINER:-flux-node-gateway}"
FLUX_V2_POSTGRES_CONTAINER="${FLUX_V2_POSTGRES_CONTAINER:-flux-postgres-v2}"
FLUX_PGBOUNCER_CONTAINER="${FLUX_PGBOUNCER_CONTAINER:-flux-pgbouncer}"
FLUX_POSTGREST_POOL_CONTAINER="${FLUX_POSTGREST_POOL_CONTAINER:-flux-postgrest-pool}"

DISK_ALERT_PERCENT="${FLUX_OPS_WATCH_DISK_ALERT_PERCENT:-90}"
LOG_MINUTES="${FLUX_OPS_WATCH_LOG_MINUTES:-15}"
LOG_CONTAINERS="${FLUX_OPS_WATCH_LOG_CONTAINERS:-flux-web,flux-gateway,flux-node-gateway,flux-postgres-v2}"

JSON=0
FINDINGS=()

emit() {
  local fingerprint="$1" message="$2"
  FINDINGS+=("${fingerprint}"$'\t'"${message}")
}

ignored_name() {
  local name="$1"
  [[ "$name" == flux-backup-verify-* || "$name" == flux-ops-watch-* || "$name" == *-canary ]]
}

tenant_hash() {
  local name="$1"
  if [[ "$name" =~ ^flux-([0-9a-f]{7})- ]]; then
    echo "${BASH_REMATCH[1]}"
  fi
}

container_running() {
  local name="$1"
  [[ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || echo false)" == "true" ]]
}

load_catalog_tsv() {
  local sys_db
  sys_db="$(docker ps --format '{{.Names}}' | grep -E 'flux-system-db$' | head -1 || true)"
  if [[ -z "$sys_db" ]]; then
    return 0
  fi
  docker exec "$sys_db" psql -U postgres -d postgres -tA -F $'\t' -c \
    "SELECT hash, COALESCE(lifecycle_state, 'active'), COALESCE(health_status, '') FROM projects;" \
    2>/dev/null || true
}

catalog_skip_exited() {
  local hash="$1" catalog="$2"
  local line chash lifecycle health
  while IFS=$'\t' read -r chash lifecycle health; do
    [[ -z "$chash" ]] && continue
    if [[ "$chash" == "$hash" ]]; then
      lifecycle="${lifecycle,,}"
      health="${health,,}"
      if [[ "$lifecycle" == "dormant" || "$lifecycle" == "archived" ]]; then
        return 0
      fi
      if [[ "$health" == "stopped" ]]; then
        return 0
      fi
      return 1
    fi
  done <<<"$catalog"
  return 0
}

watch_containers() {
  if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
    emit "docker:unavailable" "docker not available on this host"
    return
  fi

  local catalog
  catalog="$(load_catalog_tsv)"

  local -a required=(
    "$FLUX_WEB_CONTAINER"
    "$FLUX_TRAEFIK_CONTAINER"
    "$FLUX_NODE_GATEWAY_CONTAINER"
    "$FLUX_V2_POSTGRES_CONTAINER"
    "$FLUX_PGBOUNCER_CONTAINER"
    "$FLUX_POSTGREST_POOL_CONTAINER"
  )
  local name
  for name in "${required[@]}"; do
    if ! docker inspect "$name" >/dev/null 2>&1; then
      emit "docker:missing:${name}" "${name} is missing"
    fi
  done

  local sys_db
  sys_db="$(docker ps -a --format '{{.Names}}' | grep -E 'flux-system-db$' | head -1 || true)"
  if [[ -z "$sys_db" ]]; then
    emit "docker:missing:flux-system-db" "flux-system-db is missing"
  fi

  local line status health restarting
  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    ignored_name "$name" && continue
    [[ "$name" == flux-* ]] || continue

    status="$(docker inspect -f '{{.State.Status}}' "$name" 2>/dev/null || echo missing)"
    restarting="$(docker inspect -f '{{.State.Restarting}}' "$name" 2>/dev/null || echo false)"
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$name" 2>/dev/null || true)"

    if [[ "$restarting" == "true" || "$status" == "restarting" ]]; then
      emit "docker:restarting:${name}" "${name} is restarting"
      continue
    fi
    if [[ "$health" == "unhealthy" ]]; then
      emit "docker:unhealthy:${name}" "${name} is unhealthy"
      continue
    fi
    if [[ "$status" == "exited" || "$status" == "dead" || "$status" == "created" || "$status" == "paused" ]]; then
      local hash
      hash="$(tenant_hash "$name")"
      if [[ -n "$hash" && "$name" != *flux-system-db ]]; then
        if catalog_skip_exited "$hash" "$catalog"; then
          continue
        fi
      fi
      emit "docker:exited:${name}" "${name} is not running (status=${status})"
    fi
  done < <(docker ps -a --format '{{.Names}}')
}

watch_disk() {
  local path label use
  for path in / /srv /var/lib/docker; do
    [[ -e "$path" ]] || continue
    use="$(df --output=pcent "$path" 2>/dev/null | tail -1 | tr -d ' %' || true)"
    [[ "$use" =~ ^[0-9]+$ ]] || continue
    case "$path" in
      /) label=root ;;
      /srv) label=srv ;;
      /var/lib/docker) label=docker ;;
      *) continue ;;
    esac
    if [[ "$use" -ge "$DISK_ALERT_PERCENT" ]]; then
      emit "disk:${label}:${use}" "${label} filesystem is ${use}% full"
    fi
  done
}

watch_logs() {
  local IFS=,
  local name
  for name in $LOG_CONTAINERS; do
    name="${name#"${name%%[![:space:]]*}"}"
    name="${name%"${name##*[![:space:]]}"}"
    [[ -z "$name" ]] && continue
    container_running "$name" || continue
    local hits
    hits="$(docker logs --since "${LOG_MINUTES}m" --tail 200 "$name" 2>&1 \
      | grep -Ei '\\bfatal\\b|\\bpanic(ked)?\\b|oom[- ]?(killed|killer)?|out of memory' \
      || true)"
    [[ -z "$hits" ]] && continue
    if echo "$hits" | grep -Eiq 'oom[- ]?(killed|killer)?|out of memory'; then
      emit "log:oom:${name}" "${name} log matched oom"
    fi
    if echo "$hits" | grep -Eiq '\\bfatal\\b'; then
      emit "log:fatal:${name}" "${name} log matched fatal"
    fi
    if echo "$hits" | grep -Eiq '\\bpanic(ked)?\\b'; then
      emit "log:panic:${name}" "${name} log matched panic"
    fi
  done
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

print_findings() {
  local i fingerprint message
  if [[ "$JSON" == "1" ]]; then
    printf '['
    local first=1
    for ((i = 0; i < ${#FINDINGS[@]}; i++)); do
      fingerprint="${FINDINGS[$i]%%$'\t'*}"
      message="${FINDINGS[$i]#*$'\t'}"
      if [[ "$first" == "1" ]]; then
        first=0
      else
        printf ','
      fi
      printf '{"fingerprint":"%s","message":"%s"}' "$(json_escape "$fingerprint")" "$(json_escape "$message")"
    done
    printf ']\n'
    return
  fi
  for ((i = 0; i < ${#FINDINGS[@]}; i++)); do
    fingerprint="${FINDINGS[$i]%%$'\t'*}"
    message="${FINDINGS[$i]#*$'\t'}"
    echo "  FAIL: ${message}  [${fingerprint}]" >&2
  done
}

run_watch() {
  watch_containers
  watch_disk
  watch_logs
  if [[ ${#FINDINGS[@]} -eq 0 ]]; then
    exit 0
  fi
  print_findings
  exit 1
}

usage() {
  sed -n '3,28p' "$0" | sed 's/^# \{0,1\}//'
}

main() {
  local remote=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help|help)
        usage
        exit 0
        ;;
      --remote)
        remote=1
        shift
        ;;
      --json)
        JSON=1
        shift
        ;;
      *)
        echo "Unknown option: $1" >&2
        usage
        exit 2
        ;;
    esac
  done
  if [[ "$remote" == "1" ]]; then
    ssh -o BatchMode=yes -o ConnectTimeout=15 "$FLUX_SYNC_REMOTE" \
      "FLUX_REMOTE_REPO_ROOT='$FLUX_REMOTE_REPO_ROOT' FLUX_OPS_WATCH_DISK_ALERT_PERCENT='$DISK_ALERT_PERCENT' FLUX_OPS_WATCH_LOG_MINUTES='$LOG_MINUTES' FLUX_OPS_WATCH_LOG_CONTAINERS='$LOG_CONTAINERS' bash -s -- ${JSON:+--json}" <"$0"
    exit $?
  fi
  run_watch
}

main "$@"
