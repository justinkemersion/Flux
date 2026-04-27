#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCENARIO_DIR="$ROOT_DIR/perf/k6/scenarios"
RESULTS_DIR="${RESULTS_DIR:-$ROOT_DIR/perf/results}"
STAMP="${STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
RUN_DIR="$RESULTS_DIR/$STAMP"

mkdir -p "$RUN_DIR"

BASE_URL="${BASE_URL:-http://localhost:4000}"
HEALTH_URL="${HEALTH_URL:-}"
GATEWAY_CONTAINER="${GATEWAY_CONTAINER:-gateway}"
REDIS_CONTAINER="${REDIS_CONTAINER:-redis}"
SKIP_DISRUPTIVE="${SKIP_DISRUPTIVE:-0}"

health_gate_ok() {
  local -a hdrs=(-sf -o /dev/null)
  if [[ "${LOAD_TEST_HEADER:-}" == "true" ]]; then
    hdrs+=(-H "x-load-test: true")
    if [[ -n "${LOAD_TEST_KEY:-}" ]]; then
      hdrs+=(-H "x-load-test-key: ${LOAD_TEST_KEY}")
    fi
  fi
  if [[ -n "$HEALTH_URL" ]]; then
    curl "${hdrs[@]}" "$HEALTH_URL" 2>/dev/null && return 0
    return 1
  fi
  if curl "${hdrs[@]}" "${BASE_URL%/}/health" 2>/dev/null; then return 0; fi
  if curl "${hdrs[@]}" "${BASE_URL%/}/" 2>/dev/null; then return 0; fi
  return 1
}

SCENARIOS=(
  "rate-limit-calibration"
  "warm-steady"
  "cold-start"
  "redis-down"
  "db-slow"
  "hot-tenant"
  "random-host"
  "overload"
)

log() {
  printf '[matrix] %s\n' "$1"
}

write_blocked_report() {
  cat <<EOF > "$RUN_DIR/baseline.md"
# Gateway Baseline Run

- Timestamp: $STAMP
- Status: blocked
- Reason: $1

## Notes
- No scenario data was collected.
- Resolve prerequisites and rerun \`perf/k6/run-matrix.sh\`.
EOF
}

if ! command -v k6 >/dev/null 2>&1; then
  write_blocked_report "k6 is not installed"
  log "k6 not found; wrote blocked baseline report at $RUN_DIR/baseline.md"
  exit 0
fi

if ! health_gate_ok; then
  write_blocked_report "health gate failed (tried ${HEALTH_URL:-$BASE_URL/health then $BASE_URL/})"
  log "health gate failed; wrote blocked baseline report"
  exit 0
fi

log "starting matrix run in $RUN_DIR"

printf '# Gateway Baseline Run\n\n' > "$RUN_DIR/baseline.md"
printf -- '- Timestamp: %s\n' "$STAMP" >> "$RUN_DIR/baseline.md"
printf -- '- Base URL: `%s`\n\n' "$BASE_URL" >> "$RUN_DIR/baseline.md"

for scenario in "${SCENARIOS[@]}"; do
  script="$SCENARIO_DIR/$scenario.js"
  summary="$RUN_DIR/${scenario}.summary.json"
  raw="$RUN_DIR/${scenario}.log"

  if [[ ! -f "$script" ]]; then
    log "missing scenario script: $script"
    continue
  fi

  if [[ "$scenario" == "cold-start" && "$SKIP_DISRUPTIVE" != "1" ]]; then
    log "restarting gateway container ($GATEWAY_CONTAINER) for cold start"
    docker restart "$GATEWAY_CONTAINER" >/dev/null || true
    sleep 2
  fi

  if [[ "$scenario" == "redis-down" && "$SKIP_DISRUPTIVE" != "1" ]]; then
    log "stopping redis container ($REDIS_CONTAINER)"
    docker stop "$REDIS_CONTAINER" >/dev/null || true
  fi

  if [[ "$scenario" == "db-slow" ]]; then
    log "db-slow scenario expects an external DB delay injection"
  fi

  log "running $scenario"
  BASE_URL="$BASE_URL" \
    LOAD_TEST_HEADER="${LOAD_TEST_HEADER:-}" \
    LOAD_TEST_KEY="${LOAD_TEST_KEY:-}" \
    TIMEOUT="${TIMEOUT:-}" \
    HOST="${HOST:-}" \
    HOT_HOST="${HOT_HOST:-}" \
    OTHER_HOSTS="${OTHER_HOSTS:-}" \
    RANDOM_HOST_SUFFIX="${RANDOM_HOST_SUFFIX:-}" \
    k6 run "$script" --summary-export "$summary" > "$raw" 2>&1 || true

  if [[ "$scenario" == "redis-down" && "$SKIP_DISRUPTIVE" != "1" ]]; then
    log "restarting redis container ($REDIS_CONTAINER)"
    docker start "$REDIS_CONTAINER" >/dev/null || true
    sleep 1
  fi

  printf '## %s\n\n' "$scenario" >> "$RUN_DIR/baseline.md"
  printf -- '- Summary: `%s`\n' "$(basename "$summary")" >> "$RUN_DIR/baseline.md"
  printf -- '- Raw log: `%s`\n\n' "$(basename "$raw")" >> "$RUN_DIR/baseline.md"
done

cat <<EOF >> "$RUN_DIR/baseline.md"
## Interpretation

- Check each \`.summary.json\` for p95/p99 latency and status buckets.
- Regressions to prioritize: rising \`status_other_5xx\`, sustained \`504\`, memory growth under random-host.
- Overload is healthy when \`503\` rises before latency collapse.
EOF

log "completed matrix run; outputs in $RUN_DIR"
