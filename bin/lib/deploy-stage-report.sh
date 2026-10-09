#!/usr/bin/env bash
# Per-stage deploy/restart report writer.
#
# Sourced by bin/deploy-all.sh and bin/restart-all.sh. Not an entrypoint.
#
# Writes a timestamped text file as each stage finishes, then appends an
# overall footer from the EXIT trap (including fail-fast exits). Stage rows
# already on disk stay readable if the process dies before the footer.
#
# Caller env:
#   REPO_ROOT                 Repository root (required).
#   ENV_LABEL                 Optional log label (default: unknown).
#   CONTINUE_ON_WARN          1 continues after a non-zero stage (default: 0).
#   FLUX_DEPLOY_REPORT_DIR    Report directory. Relative paths are under
#                             REPO_ROOT. Default: <repo>/tmp/deploy-reports.
#
# Globals set for the caller:
#   DEPLOY_REPORT_FILE        Absolute path of this run's report.

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "ERROR: source bin/lib/deploy-stage-report.sh; do not execute it." >&2
  exit 1
fi

deploy_report_format_elapsed() {
  local start_ns="$1"
  local end_ns="$2"
  local delta_ns=$((end_ns - start_ns))
  if ((delta_ns < 0)); then
    delta_ns=0
  fi
  local ms=$((delta_ns / 1000000))
  printf '%d.%03d' $((ms / 1000)) $((ms % 1000))
}

deploy_report_begin() {
  local kind="${1:?deploy report kind required}"
  if [[ ! "$kind" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
    echo "ERROR: invalid stage report kind: ${kind}" >&2
    return 1
  fi

  local dir="${FLUX_DEPLOY_REPORT_DIR:-${REPO_ROOT}/tmp/deploy-reports}"
  if [[ "$dir" != /* ]]; then
    dir="${REPO_ROOT}/${dir#./}"
  fi
  mkdir -p "$dir"

  local stamp continue_on_warn
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  if [[ "${CONTINUE_ON_WARN:-0}" == "1" ]]; then
    continue_on_warn="1"
  else
    continue_on_warn="0"
  fi

  DEPLOY_REPORT_KIND="$kind"
  DEPLOY_REPORT_FILE="${dir}/${kind}-${stamp}-$$.txt"
  DEPLOY_REPORT_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  DEPLOY_REPORT_START_NS="$(date +%s%N)"
  DEPLOY_REPORT_CONTINUE="$continue_on_warn"
  DEPLOY_REPORT_STAGES_RECORDED=0
  DEPLOY_REPORT_STAGES_FAILED=0
  DEPLOY_REPORT_STOPPED_EARLY=0
  DEPLOY_REPORT_FINALIZED=0
  DEPLOY_REPORT_RESULT="incomplete"

  {
    printf 'flux_stage_report: 1\n'
    printf 'kind: %s\n' "$kind"
    printf 'started_at: %s\n' "$DEPLOY_REPORT_STARTED_AT"
    printf 'env: %s\n' "${ENV_LABEL:-unknown}"
    printf 'continue_on_warn: %s\n' "$continue_on_warn"
    printf 'repo: %s\n' "$REPO_ROOT"
    printf 'report: %s\n' "$DEPLOY_REPORT_FILE"
    printf '\n'
    printf '# stage\tname\texit_code\telapsed_s\tresult\n'
  } >"$DEPLOY_REPORT_FILE"

  echo "  stage_report: ${DEPLOY_REPORT_FILE}"
}

deploy_report_append_stage() {
  local name="$1"
  local code="$2"
  local elapsed="$3"
  local stage_result="ok"

  name="${name//$'\t'/ }"
  name="${name//$'\n'/ }"
  if [[ "$code" != "0" ]]; then
    stage_result="failed"
    DEPLOY_REPORT_STAGES_FAILED=$((DEPLOY_REPORT_STAGES_FAILED + 1))
  fi
  DEPLOY_REPORT_STAGES_RECORDED=$((DEPLOY_REPORT_STAGES_RECORDED + 1))
  printf 'stage\t%s\t%s\t%s\t%s\n' "$name" "$code" "$elapsed" "$stage_result" >>"$DEPLOY_REPORT_FILE"
}

# Run one orchestrator stage. Child git sync stays off (the parent already
# pulled once, if at all). Exit status matches the child unless
# CONTINUE_ON_WARN=1, which records the real child status and returns 0.
deploy_report_run_stage() {
  local name="$1"
  local script="$2"
  local start_ns end_ns elapsed code=0

  echo ""
  echo "=== Stage: ${name} ==="

  start_ns="$(date +%s%N)"
  if FLUX_DEPLOY_GIT_SYNC=0 "$script"; then
    code=0
  else
    code=$?
  fi
  end_ns="$(date +%s%N)"
  elapsed="$(deploy_report_format_elapsed "$start_ns" "$end_ns")"
  deploy_report_append_stage "$name" "$code" "$elapsed"

  if ((code == 0)); then
    echo "=== Stage OK: ${name} ==="
    return 0
  fi

  echo "=== Stage FAILED (${code}): ${name} ===" >&2
  if [[ "${CONTINUE_ON_WARN:-0}" == "1" ]]; then
    echo "  WARN: continuing because FLUX_DEPLOY_CONTINUE_ON_WARN=1" >&2
    return 0
  fi
  DEPLOY_REPORT_STOPPED_EARLY=1
  return "$code"
}

deploy_report_finalize() {
  local code="${1:-0}"
  if [[ "${DEPLOY_REPORT_FINALIZED:-0}" == "1" ]]; then
    return 0
  fi
  DEPLOY_REPORT_FINALIZED=1

  local finished_at overall_elapsed note result
  finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  overall_elapsed="$(deploy_report_format_elapsed "$DEPLOY_REPORT_START_NS" "$(date +%s%N)")"

  if ((DEPLOY_REPORT_STAGES_FAILED > 0)) && [[ "$code" == "0" ]]; then
    result="continued_with_failures"
    note="FLUX_DEPLOY_CONTINUE_ON_WARN=1 recorded stage failures without failing the script"
  elif [[ "$code" != "0" ]] && [[ "${DEPLOY_REPORT_STOPPED_EARLY}" == "1" ]]; then
    result="failed"
    note="fail-fast stopped the run; later stages were not run"
  elif [[ "$code" != "0" ]] && ((DEPLOY_REPORT_STAGES_RECORDED == 0)); then
    result="failed"
    note="no stage results recorded"
  elif [[ "$code" != "0" ]]; then
    result="failed"
    note="run exited non-zero"
  else
    result="ok"
    note="all recorded stages exited 0"
  fi
  DEPLOY_REPORT_RESULT="$result"

  {
    printf '\n'
    printf 'finished_at: %s\n' "$finished_at"
    printf 'overall_exit: %s\n' "$code"
    printf 'overall_elapsed_s: %s\n' "$overall_elapsed"
    printf 'stages_recorded: %s\n' "$DEPLOY_REPORT_STAGES_RECORDED"
    printf 'stages_failed: %s\n' "$DEPLOY_REPORT_STAGES_FAILED"
    printf 'stopped_early: %s\n' "$DEPLOY_REPORT_STOPPED_EARLY"
    printf 'result: %s\n' "$result"
    printf 'note: %s\n' "$note"
  } >>"$DEPLOY_REPORT_FILE"
}

deploy_report_on_exit() {
  local code=$?
  deploy_report_finalize "$code" || true
  if [[ -n "${DEPLOY_REPORT_FILE:-}" ]]; then
    echo "  stage_report: ${DEPLOY_REPORT_FILE}"
    echo "  stage_report_result: ${DEPLOY_REPORT_RESULT:-unknown} (overall_exit ${code})"
  fi
  exit "$code"
}
