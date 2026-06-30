#!/usr/bin/env bash
# Read-only production health audit for a Flux Docker host.
#
# Run on the server (canonical repo: /srv/platform/flux):
#   ./bin/ops-audit.sh
#
# Run from your laptop over SSH (same defaults as bin/sync-env-remote.sh):
#   ./bin/ops-audit.sh --remote
#   ./bin/ops-audit.sh --remote --deep --smoke
#
# --smoke  GET each tenant API via Traefik :80 (Host: api--<slug>--<hash>.<domain>).
#          v2 gateway 401 without Bearer = expected auth challenge (OK); 404 = FAIL.
#          Targets: bin/ops-audit-smoke.projects (copy from ops-audit-smoke.projects.example),
#          or FLUX_OPS_SMOKE_PROJECTS=slug:hash,... or catalog query when unset.
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

# When piped over SSH (`bash -s`), BASH_SOURCE is unset; use FLUX_REMOTE_REPO_ROOT/bin.
if [[ -n "${BASH_SOURCE[0]:-}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
  SCRIPT_DIR="$(cd "${FLUX_REMOTE_REPO_ROOT:-.}/bin" && pwd)"
fi
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

LOG_TAIL="${FLUX_OPS_LOG_TAIL:-500}"
DEEP="${FLUX_OPS_DEEP:-0}"
SMOKE="${FLUX_OPS_SMOKE:-0}"
FLUX_OPS_SMOKE_FILE="${FLUX_OPS_SMOKE_FILE:-$SCRIPT_DIR/ops-audit-smoke.projects}"

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

  local sched_logs sched_err backup_err fleet_err sys_err started_at
  started_at="$(docker inspect -f '{{.State.StartedAt}}' "$FLUX_WEB_CONTAINER" 2>/dev/null || true)"
  if [[ -n "$started_at" ]]; then
    sched_logs="$(docker logs --since "$started_at" "$FLUX_WEB_CONTAINER" 2>&1 || true)"
  else
    sched_logs="$logs"
  fi
  # Errors use logBackupSchedulerError: "backup-scheduler: … — detail" (not tick "failed=0").
  sched_err="$(echo "$sched_logs" | grep -c 'backup-scheduler:.* — ' || true)"
  backup_err="$(echo "$sched_logs" | grep -c 'backup-scheduler: failed project' || true)"
  fleet_err="$(echo "$sched_logs" | grep -c 'fleet-monitor.*failed' || true)"
  sys_err="$(echo "$logs" | grep -c 'System DB initialisation failed' || true)"

  if [[ "$sys_err" -gt 0 ]]; then
    fail "System DB initialisation failed ($sys_err in tail)"
  fi
  if [[ "$backup_err" -gt 0 ]]; then
    warn "backup-scheduler project failures since container start ($backup_err) — run: docker logs $FLUX_WEB_CONTAINER 2>&1 | grep backup-scheduler"
  elif [[ "$sched_err" -gt 0 ]]; then
    warn "backup-scheduler errors since container start ($sched_err)"
  else
    pass "no backup-scheduler failures since container start"
  fi
  if [[ "$fleet_err" -gt 0 ]]; then
    warn "fleet-monitor failures since container start ($fleet_err)"
  else
    pass "no fleet-monitor failures since container start"
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
    local traefik_started
    traefik_started="$(docker inspect -f '{{.State.StartedAt}}' "$FLUX_TRAEFIK_CONTAINER" 2>/dev/null || true)"
    if [[ -n "$traefik_started" ]]; then
      acme_err="$(docker logs --since "$traefik_started" "$FLUX_TRAEFIK_CONTAINER" 2>&1 | grep -ci 'acme.*error\|unable to obtain certificate' || true)"
    else
      acme_err="$(docker logs "$FLUX_TRAEFIK_CONTAINER" 2>&1 | tail -200 | grep -ci 'acme.*error\|unable to obtain certificate' || true)"
    fi
    if [[ "$acme_err" -gt 0 ]]; then
      warn "Traefik ACME/certificate errors since container start ($acme_err) — check docker logs $FLUX_TRAEFIK_CONTAINER 2>&1 | grep -i acme | tail -5"
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
  elif [[ "$root_use" -ge 80 ]] 2>/dev/null; then
    warn "root filesystem >= 80% full (plan cleanup before 90%)"
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
  local sys_db sql_file
  sys_db="$(docker ps --format '{{.Names}}' | grep -E 'flux-system-db$' | head -1 || true)"
  sql_file="${SCRIPT_DIR}/ops-audit/sql/backup-catalog-latest.sql"
  if [[ -z "$sys_db" ]]; then
    warn "flux-system-db container not found — skip catalog query"
    return
  fi
  if [[ ! -f "$sql_file" ]]; then
    fail "missing ops-audit SQL: $sql_file"
    return
  fi
  local rows
  rows="$(docker exec -i "$sys_db" psql -U postgres -d postgres -tA -F '|' -f - <"$sql_file" 2>/dev/null || true)"
  if [[ -z "$rows" ]]; then
    warn "could not read project_backups from $sys_db"
    return
  fi
  while IFS='|' read -r slug hash mode lifecycle st art restore offsite created; do
    [[ -z "$slug" || -z "$hash" ]] && continue
    local label="${slug}:${hash} (${mode}, ${lifecycle:-active})"
    echo "  $label latest=$created status=$st art=$art restore=$restore offsite=$offsite"
    if [[ "${lifecycle:-active}" != "active" ]]; then
      if [[ "$restore" == "restore_failed" ]]; then
        warn "$label: latest backup restore_verification failed (lifecycle=${lifecycle:-unknown}; skipped FAIL)"
      fi
      continue
    fi
    if [[ "$restore" == "pending" && "$st" == "complete" ]]; then
      warn "$label: latest backup is NOT restore-verified — run: flux backup verify -p $slug --hash $hash --latest"
    fi
    if [[ "$restore" == "restore_failed" ]]; then
      fail "$label: latest backup restore_verification failed"
    fi
    if [[ "$offsite" == "failed" ]]; then
      warn "$label: offsite replication failed on latest backup"
    fi
  done <<<"$rows"

  audit_platform_backup_freshness "$sys_db"
}

read_min_backup_interval_days() {
  local env_file=""
  if [[ -f "${FLUX_REMOTE_REPO_ROOT}/docker/web/.env" ]]; then
    env_file="${FLUX_REMOTE_REPO_ROOT}/docker/web/.env"
  elif [[ -f "${REPO_ROOT}/docker/web/.env" ]]; then
    env_file="${REPO_ROOT}/docker/web/.env"
  fi
  local d="7"
  if [[ -n "$env_file" ]]; then
    d="$(grep -E '^\s*FLUX_MIN_BACKUP_INTERVAL_DAYS=' "$env_file" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"' " | tr -d ' ' || true)"
  fi
  [[ -z "$d" || ! "$d" =~ ^[0-9]+$ ]] && d="7"
  echo "$d"
}

audit_platform_backup_freshness() {
  local sys_db="$1"
  section "Platform minimum backup freshness"
  local interval_days sql_file
  interval_days="$(read_min_backup_interval_days)"
  sql_file="${SCRIPT_DIR}/ops-audit/sql/platform-backup-freshness.sql"
  echo "  interval_days=$interval_days (restore-verified age threshold; active projects only)"
  if [[ ! -f "$sql_file" ]]; then
    fail "missing ops-audit SQL: $sql_file"
    return
  fi

  local freshness_rows
  freshness_rows="$(docker exec -i "$sys_db" psql -U postgres -d postgres -tA -F '|' -f - <"$sql_file" 2>/dev/null || true)"
  if [[ -z "$freshness_rows" ]]; then
    warn "could not read restore-verified freshness from $sys_db"
    return
  fi
  while IFS='|' read -r slug hash mode verified_date age_days; do
    [[ -z "$slug" || -z "$hash" ]] && continue
    local label="${slug}:${hash} (${mode})"
    if [[ -z "$verified_date" || "$verified_date" == "" ]]; then
      warn "$label: no restore-verified backup — platform minimum backup freshness not met"
      continue
    fi
    echo "  $label newest_verified=$verified_date age_days=${age_days:-?}"
    if [[ -n "${age_days:-}" && "$age_days" =~ ^[0-9]+$ && "$age_days" -gt "$interval_days" ]]; then
      warn "$label: restore-verified backup is ${age_days}d old (platform minimum: ${interval_days}d)"
    fi
  done <<<"$freshness_rows"
}

read_flux_domain() {
  local env_file="${FLUX_REMOTE_REPO_ROOT}/docker/web/.env"
  local d=""
  if [[ -f "$env_file" ]]; then
    d="$(grep -E '^\s*FLUX_DOMAIN=' "$env_file" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"' " | tr -d ' ' || true)"
  fi
  echo "${d:-vsl-base.com}"
}

tenant_smoke_host() {
  local slug="$1" hash="$2" domain="$3"
  echo "api--${slug}--${hash}.${domain}"
}

edge_smoke_status_ok() {
  case "$1" in
    200|301|302|307|308) return 0 ;;
    *) return 1 ;;
  esac
}

probe_tenant_api() {
  local slug="$1" hash="$2" mode="${3:-}" lifecycle="${4:-active}"
  local domain host label code gw_code
  domain="$(read_flux_domain)"
  host="$(tenant_smoke_host "$slug" "$hash" "$domain")"
  label="$slug:$hash"
  [[ -n "$mode" ]] && label="$label ($mode)"

  if ! command -v curl >/dev/null 2>&1; then
    warn "$label — skip edge smoke (curl not on host)"
    return
  fi

  # Public edge (Traefik :80): same Host clients use after DNS — matches deploy-web.sh probes.
  code="$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 -H "Host: ${host}" "http://127.0.0.1/" 2>/dev/null || echo "000")"
  if edge_smoke_status_ok "$code"; then
    pass "$label — edge GET Host:${host} → ${code}"
  else
    fail "$label — edge smoke HTTP ${code} (Host: ${host})"
  fi

  # v2_shared: gateway must resolve Host and proxy (real app path). Use node:http — fetch()
  # cannot set Host (forbidden header); the server would see 127.0.0.1:4000 and 404.
  if [[ "$mode" == "v2_shared" ]] && container_running "$FLUX_NODE_GATEWAY_CONTAINER"; then
    set +e
    gw_code="$(docker exec "$FLUX_NODE_GATEWAY_CONTAINER" node -e "
const http = require('http');
const host = '${host}';
const req = http.request(
  { hostname: '127.0.0.1', port: 4000, path: '/', method: 'GET', headers: { host }, timeout: 5000 },
  (res) => { console.log(String(res.statusCode)); res.resume(); },
);
req.on('error', () => process.exit(2));
req.end();
" 2>/dev/null)"
    set -e
    gw_code="${gw_code//$'\n'/}"
    if [[ -z "$gw_code" || "$gw_code" == "2" ]]; then
      warn "$label — gateway smoke unreachable (internal Host:${host})"
    elif [[ "$gw_code" == "404" ]]; then
      fail "$label — gateway tenant not found (catalog/parse miss for Host:${host})"
    elif [[ "$gw_code" == "401" ]]; then
      pass "$label — gateway 401 expected auth challenge (tenant resolved; Bearer required)"
    elif [[ "$gw_code" == "503" && "$lifecycle" != "active" ]]; then
      pass "$label — gateway 503 expected for lifecycle=${lifecycle}"
    elif edge_smoke_status_ok "$gw_code"; then
      pass "$label — gateway internal Host:${host} → ${gw_code}"
    else
      warn "$label — gateway HTTP ${gw_code} (edge was ${code})"
    fi
  elif [[ "$mode" == "v1_dedicated" ]] && container_running "$FLUX_NODE_GATEWAY_CONTAINER"; then
    set +e
    gw_code="$(docker exec "$FLUX_NODE_GATEWAY_CONTAINER" node -e "
const http = require('http');
const host = '${host}';
const req = http.request(
  { hostname: '127.0.0.1', port: 4000, path: '/', method: 'GET', headers: { host }, timeout: 5000 },
  (res) => { console.log(String(res.statusCode)); res.resume(); },
);
req.on('error', () => process.exit(2));
req.end();
" 2>/dev/null)"
    set -e
    gw_code="${gw_code//$'\n'/}"
    if [[ "$gw_code" == "502" ]]; then
      pass "$label — gateway correctly rejects v1 (502, use Traefik → dedicated PostgREST)"
    elif [[ "$gw_code" == "404" ]]; then
      fail "$label — gateway catalog miss for v1 Host:${host}"
    elif [[ -n "$gw_code" && "$gw_code" != "2" ]]; then
      warn "$label — gateway returned ${gw_code} for v1 (expected 502)"
    fi
  fi
}

load_smoke_targets() {
  if [[ -n "${FLUX_OPS_SMOKE_PROJECTS:-}" ]]; then
    local IFS=,
    local entry slug hash mode lifecycle rest
    for entry in $FLUX_OPS_SMOKE_PROJECTS; do
      entry="${entry#"${entry%%[![:space:]]*}"}"
      entry="${entry%"${entry##*[![:space:]]}"}"
      [[ -z "$entry" ]] && continue
      IFS=: read -r slug hash mode lifecycle rest <<<"$entry"
      [[ -z "$slug" || -z "$hash" ]] && continue
      echo "$slug|$hash|${mode:-}|${lifecycle:-active}"
    done
    return
  fi

  if [[ -f "$FLUX_OPS_SMOKE_FILE" ]]; then
    local line slug hash mode lifecycle rest
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line%%#*}"
      line="${line#"${line%%[![:space:]]*}"}"
      line="${line%"${line##*[![:space:]]}"}"
      [[ -z "$line" ]] && continue
      IFS=: read -r slug hash mode lifecycle rest <<<"$line"
      [[ -z "$slug" || -z "$hash" ]] && continue
      echo "$slug|$hash|${mode:-}|${lifecycle:-active}"
    done <"$FLUX_OPS_SMOKE_FILE"
    return
  fi

  local sys_db
  sys_db="$(docker ps --format '{{.Names}}' | grep -E 'flux-system-db$' | head -1 || true)"
  if [[ -z "$sys_db" ]]; then
    return
  fi
  docker exec "$sys_db" psql -U postgres -d postgres -tA -F '|' -c "
    SELECT slug, hash, COALESCE(mode, ''), COALESCE(lifecycle_state, 'active')
    FROM projects
    WHERE slug NOT IN ('flux-system', 'static')
    ORDER BY slug;
  " 2>/dev/null || true
}

audit_tenant_smoke() {
  section "Tenant API smoke (Traefik edge Host header)"
  if ! container_running "$FLUX_TRAEFIK_CONTAINER"; then
    warn "skip — $FLUX_TRAEFIK_CONTAINER not running"
    return
  fi

  local env_file="${FLUX_REMOTE_REPO_ROOT}/docker/web/.env"
  if [[ -f "$env_file" ]] && grep -Eq '^\s*FLUX_TENANT_PROBE_GATEWAY_URL=' "$env_file"; then
    pass "FLUX_TENANT_PROBE_GATEWAY_URL set (fleet monitor); smoke uses Traefik :80 for edge routing"
  else
    warn "FLUX_TENANT_PROBE_GATEWAY_URL unset — fleet mesh may disagree with edge smoke"
  fi

  local rows target_count=0
  rows="$(load_smoke_targets)"
  if [[ -z "$rows" ]]; then
    warn "no smoke targets — copy bin/ops-audit-smoke.projects.example to bin/ops-audit-smoke.projects"
    return
  fi

  while IFS='|' read -r slug hash mode lifecycle; do
    [[ -z "$slug" || -z "$hash" ]] && continue
    target_count=$((target_count + 1))
    probe_tenant_api "$slug" "$hash" "$mode" "${lifecycle:-active}"
  done <<<"$rows"

  if [[ "$target_count" -eq 0 ]]; then
    warn "smoke file/env had no valid slug:hash lines"
  else
    pass "smoke probes attempted: $target_count"
  fi
}

audit_host_cron() {
  section "Host cron (flux reap / custom)"
  if command -v crontab >/dev/null 2>&1; then
    local cron_lines
    cron_lines="$(crontab -l 2>/dev/null | grep -i flux || true)"
    if [[ -n "$cron_lines" ]]; then
      echo "$cron_lines" | sed 's/^/  /'
      pass "host crontab entries present"
    elif container_running "$FLUX_WEB_CONTAINER"; then
      pass "no host crontab — backups/fleet schedulers run in flux-web; flux reap (idle stop) is optional on the host"
    else
      warn "no flux-related crontab entries and flux-web not running"
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
  if [[ "$SMOKE" == "1" ]]; then
    audit_tenant_smoke
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
      --smoke)
        SMOKE=1
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
    echo "Remote audit via SSH: $FLUX_SYNC_REMOTE (deep=${DEEP} smoke=${SMOKE})"
    ssh -o BatchMode=yes -o ConnectTimeout=15 "$FLUX_SYNC_REMOTE" \
      "FLUX_REMOTE_REPO_ROOT='$FLUX_REMOTE_REPO_ROOT' FLUX_OPS_DEEP='$DEEP' FLUX_OPS_SMOKE='$SMOKE' FLUX_OPS_SMOKE_FILE='$FLUX_REMOTE_REPO_ROOT/bin/ops-audit-smoke.projects' bash -s" <"$0"
    exit $?
  fi
  run_audit
}

main "$@"
