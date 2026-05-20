#!/usr/bin/env bash
# Read-only production health audit for a Flux Docker host.
#
# Run on the server (canonical repo: /srv/platform/flux):
#   ./bin/ops-audit.sh
#
# Run from your laptop over SSH (same defaults as bin/sync-env-remote.sh):
#   ./bin/ops-audit.sh --remote
#
# Env overrides (match bin/sync-env-remote.sh / bin/use-remote-docker-hetzner.sh):
#   FLUX_SYNC_REMOTE=root@host
#   FLUX_REMOTE_REPO_ROOT=/srv/platform/flux
#
# Exit codes: 0 = no hard failures; 1 = one or more FAIL findings.
# WARN lines do not fail the run (review them anyway).
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

LOG_TAIL="${FLUX_OPS_LOG_TAIL:-500}"
DEEP="${FLUX_OPS_DEEP:-0}"
FAIL_COUNT=0
WARN_COUNT=0

section() {
  echo ""
  echo "=== $* ==="
}

pass() {
  echo "  OK: $*"
}

warn() {
  WARN_COUNT=$((WARN_COUNT + 1))
  echo "  WARN: $*" >&2
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "  FAIL: $*" >&2
}

docker_ok() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

container_running() {
  local name="$1"
  [[ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || echo false)" == "true" ]]
}

container_restarts() {
  local name="$1"
  docker inspect -f '{{.RestartCount}}' "$name" 2>/dev/null || echo "?"
}

audit_containers() {
  section "Core containers"
  local -a required=(
    "$FLUX_WEB_CONTAINER"
    "$FLUX_TRAEFIK_CONTAINER"
    "$FLUX_NODE_GATEWAY_CONTAINER"
  )
  for c in "${required[@]}"; do
    if container_running "$c"; then
      pass "$c running (restarts=$(container_restarts "$c"))"
    else
      local st
      st="$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo missing)"
      fail "$c not running (status=$st)"
    fi
  done

  if container_running "$FLUX_V2_POSTGRES_CONTAINER"; then
    pass "$FLUX_V2_POSTGRES_CONTAINER running (restarts=$(container_restarts "$FLUX_V2_POSTGRES_CONTAINER"))"
  else
    warn "$FLUX_V2_POSTGRES_CONTAINER not running (v2_shared may be unused or down)"
  fi

  local tenant_count
  tenant_count="$(docker ps --format '{{.Names}}' | grep -cE '^flux-[0-9a-f]{7}-' || true)"
  pass "tenant stacks (flux-<hash>-* name prefix): $tenant_count running"

  docker ps -a --filter "status=restarting" --format '{{.Names}} {{.Status}}' | while read -r line; do
    [[ -z "$line" ]] && continue
    fail "restart loop: $line"
  done
}

audit_flux_web_logs() {
  section "flux-web logs (last ${LOG_TAIL} lines)"
  if ! container_running "$FLUX_WEB_CONTAINER"; then
    warn "skip log scan — $FLUX_WEB_CONTAINER not running"
    return
  fi

  local logs
  logs="$(docker logs "$FLUX_WEB_CONTAINER" 2>&1 | tail -n "$LOG_TAIL")"

  if echo "$logs" | grep -q 'System DB ready'; then
    pass "System DB ready seen in recent logs"
  else
    warn "System DB ready not in last ${LOG_TAIL} log lines (container may have started earlier)"
  fi

  if echo "$logs" | grep -q 'Backup scheduler started'; then
    pass "backup scheduler started"
  else
    warn "backup scheduler start message not in recent logs"
  fi

  if echo "$logs" | grep -q 'Fleet monitor started'; then
    pass "fleet monitor started"
  else
    warn "fleet monitor start message not in recent logs"
  fi

  local sched_err backup_err fleet_err sys_err
  sched_err="$(echo "$logs" | grep -c 'backup-scheduler.*failed' || true)"
  backup_err="$(echo "$logs" | grep -c 'backup-scheduler: failed project' || true)"
  fleet_err="$(echo "$logs" | grep -c 'fleet-monitor.*failed' || true)"
  sys_err="$(echo "$logs" | grep -c 'System DB initialisation failed' || true)"

  if [[ "$sys_err" -gt 0 ]]; then
    fail "System DB initialisation failed ($sys_err in tail)"
  fi
  if [[ "$backup_err" -gt 0 ]]; then
    warn "backup-scheduler project failures in tail ($backup_err) — run: docker logs $FLUX_WEB_CONTAINER 2>&1 | grep backup-scheduler"
  elif [[ "$sched_err" -gt 0 ]]; then
    warn "backup-scheduler errors in tail ($sched_err)"
  else
    pass "no backup-scheduler failures in log tail"
  fi
  if [[ "$fleet_err" -gt 0 ]]; then
    warn "fleet-monitor failures in tail ($fleet_err)"
  else
    pass "no fleet-monitor failures in log tail"
  fi

  local other_err
  other_err="$(echo "$logs" | grep -ciE '\[flux\].*error|console\.error' || true)"
  if [[ "$other_err" -gt 5 ]]; then
    warn "many [flux]/error lines in tail ($other_err) — spot-check: docker logs $FLUX_WEB_CONTAINER 2>&1 | grep -i error | tail -30"
  fi
}

audit_web_env_hints() {
  section "Control-plane env hints (names only)"
  local env_file="${FLUX_REMOTE_REPO_ROOT}/docker/web/.env"
  if [[ ! -f "$env_file" ]]; then
    warn "missing $env_file — cannot check FLUX_TENANT_PROBE_GATEWAY_URL"
    return
  fi
  if grep -Eq '^\s*FLUX_TENANT_PROBE_GATEWAY_URL=' "$env_file"; then
    pass "FLUX_TENANT_PROBE_GATEWAY_URL is set"
  else
    warn "FLUX_TENANT_PROBE_GATEWAY_URL unset — dashboard mesh probes may show false Offline"
  fi
  if grep -Eq '^\s*FLUX_SHARED_POSTGRES_URL=' "$env_file"; then
    pass "FLUX_SHARED_POSTGRES_URL is set (v2 control-plane)"
  else
    warn "FLUX_SHARED_POSTGRES_URL unset — v2 provisioning from dashboard may fail"
  fi
}

audit_backup_volumes() {
  section "Backup storage (inside $FLUX_WEB_CONTAINER)"
  if ! container_running "$FLUX_WEB_CONTAINER"; then
    warn "skip backup volume check"
    return
  fi
  docker exec "$FLUX_WEB_CONTAINER" sh -c '
    set -e
    for d in /srv/flux/backups /srv/flux/backups-offsite; do
      if [ -d "$d" ]; then
        echo "  dir $d: $(du -sh "$d" 2>/dev/null | cut -f1) projects=$(find "$d" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)"
        find "$d" -name "*.dump" -type f 2>/dev/null | wc -l | xargs -I{} echo "  dumps under $d: {}"
      else
        echo "  MISSING $d"
      fi
    done
  ' 2>/dev/null || warn "could not inspect backup dirs in container"

  local vol_name
  vol_name="$(docker inspect "$FLUX_WEB_CONTAINER" --format '{{range .Mounts}}{{if eq .Destination "/srv/flux/backups"}}{{.Name}}{{end}}{{end}}' 2>/dev/null || true)"
  if [[ -n "$vol_name" ]]; then
    local mp
    mp="$(docker volume inspect -f '{{.Mountpoint}}' "$vol_name" 2>/dev/null || true)"
    pass "backup volume $vol_name → $mp"
  else
    warn "could not resolve backup volume from $FLUX_WEB_CONTAINER mounts"
  fi
}

audit_gateway_health() {
  section "Gateway / edge"
  if container_running "$FLUX_NODE_GATEWAY_CONTAINER"; then
    local code
    code="$(docker exec "$FLUX_NODE_GATEWAY_CONTAINER" node -e \
      "fetch('http://127.0.0.1:4000/health').then(r=>{console.log(r.status);process.exit(r.ok?0:1)}).catch(e=>{console.error(e);process.exit(2)})" \
      2>/dev/null || echo fail)"
    if [[ "$code" == "200" ]]; then
      pass "$FLUX_NODE_GATEWAY_CONTAINER /health → $code"
    else
      warn "$FLUX_NODE_GATEWAY_CONTAINER /health probe returned: $code"
    fi
  else
    warn "$FLUX_NODE_GATEWAY_CONTAINER not running — skip in-container health"
  fi

  if container_running "$FLUX_TRAEFIK_CONTAINER"; then
    pass "$FLUX_TRAEFIK_CONTAINER running (restarts=$(container_restarts "$FLUX_TRAEFIK_CONTAINER"))"
    local acme_err
    acme_err="$(docker logs "$FLUX_TRAEFIK_CONTAINER" 2>&1 | tail -200 | grep -ci 'acme.*error\|unable to obtain certificate' || true)"
    if [[ "$acme_err" -gt 0 ]]; then
      warn "Traefik log tail has ACME/certificate errors ($acme_err)"
    fi
  fi
}

audit_disk() {
  section "Host disk"
  df -h / /var/lib/docker 2>/dev/null | sed 's/^/  /' || df -h | sed 's/^/  /'
  local docker_df
  docker_df="$(docker system df 2>/dev/null | sed 's/^/  /' || true)"
  if [[ -n "$docker_df" ]]; then
    echo "$docker_df"
  fi
  local root_use
  root_use="$(df / --output=pcent 2>/dev/null | tail -1 | tr -d ' %' || echo 0)"
  if [[ "$root_use" -ge 90 ]] 2>/dev/null; then
    warn "root filesystem >= 90% full"
  fi
}

audit_stale_containers() {
  section "Stopped / stale Flux containers"
  local stale
  stale="$(docker ps -a --filter "status=exited" --format '{{.Names}} {{.Status}}' | grep -E '^flux-' || true)"
  if [[ -z "$stale" ]]; then
    pass "no exited flux-* containers"
  else
    echo "$stale" | sed 's/^/  /'
    warn "exited tenant containers above — confirm orphans vs intentional stops"
  fi
}

audit_backup_catalog() {
  section "Backup catalog (latest per project)"
  local sys_db
  sys_db="$(docker ps --format '{{.Names}}' | grep -E 'flux-system-db$' | head -1 || true)"
  if [[ -z "$sys_db" ]]; then
    warn "flux-system-db container not found — skip catalog query"
    return
  fi
  local rows
  rows="$(docker exec "$sys_db" psql -U postgres -d postgres -tA -F '|' -c "
    SELECT DISTINCT ON (p.slug)
      p.slug, p.mode, b.status,
      b.artifact_validation_status,
      b.restore_verification_status,
      b.offsite_status,
      b.created_at::date
    FROM project_backups b
    JOIN projects p ON p.id = b.project_id
    ORDER BY p.slug, b.created_at DESC;
  " 2>/dev/null || true)"
  if [[ -z "$rows" ]]; then
    warn "could not read project_backups from $sys_db"
    return
  fi
  while IFS='|' read -r slug mode st art restore offsite created; do
    [[ -z "$slug" ]] && continue
    echo "  $slug ($mode) latest=$created status=$st art=$art restore=$restore offsite=$offsite"
    if [[ "$restore" == "pending" && "$st" == "complete" ]]; then
      warn "$slug: latest backup is NOT restore-verified — run: flux backup verify -p $slug --hash <hash> --latest"
    fi
    if [[ "$restore" == "restore_failed" ]]; then
      fail "$slug: latest backup restore_verification failed"
    fi
    if [[ "$offsite" == "failed" ]]; then
      warn "$slug: offsite replication failed on latest backup"
    fi
  done <<<"$rows"
}

audit_host_cron() {
  section "Host cron (flux reap / custom)"
  if command -v crontab >/dev/null 2>&1; then
    local cron_lines
    cron_lines="$(crontab -l 2>/dev/null | grep -i flux || true)"
    if [[ -n "$cron_lines" ]]; then
      echo "$cron_lines" | sed 's/^/  /'
    else
      warn "no flux-related crontab entries (flux reap is host-scheduled, not in flux-web)"
    fi
  else
    warn "crontab not available"
  fi
}

run_audit() {
  echo "Flux ops audit — $(date -u +%Y-%m-%dT%H:%M:%SZ) — host $(hostname -f 2>/dev/null || hostname)"
  if ! docker_ok; then
    fail "docker not available on this host"
    return 1
  fi
  audit_containers
  audit_flux_web_logs
  audit_web_env_hints
  audit_backup_volumes
  audit_gateway_health
  audit_stale_containers
  if [[ "$DEEP" == "1" ]]; then
    audit_backup_catalog
  fi
  audit_disk
  audit_host_cron

  section "Summary"
  echo "  FAIL: $FAIL_COUNT  WARN: $WARN_COUNT"
  if [[ "$FAIL_COUNT" -gt 0 ]]; then
    echo "  Result: FAILED — address FAIL items before relying on unattended backups/schedulers."
    return 1
  fi
  echo "  Result: PASSED (review WARN lines for drift)."
  return 0
}

usage() {
  sed -n '3,16p' "$0" | sed 's/^# \{0,1\}//'
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
      --deep)
        DEEP=1
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
    echo "Remote audit via SSH: $FLUX_SYNC_REMOTE (deep=${DEEP})"
    ssh -o BatchMode=yes -o ConnectTimeout=15 "$FLUX_SYNC_REMOTE" \
      "FLUX_REMOTE_REPO_ROOT='$FLUX_REMOTE_REPO_ROOT' FLUX_OPS_DEEP='$DEEP' bash -s" <"$0"
    exit $?
  fi
  run_audit
}

main "$@"
