#!/usr/bin/env bash
# Dry-run of the deploy/restart stage report writer. No Docker.
#
# Operator confirmation on a host: run ./bin/deploy-all.sh or ./bin/restart-all.sh.
# Both print `stage_report:` at start and end. The file is timestamped under
# tmp/deploy-reports/ (or FLUX_DEPLOY_REPORT_DIR) and has one `stage` row per
# completed stage (exit_code, elapsed_s) plus an overall footer. Fail-fast
# still leaves that file in place; a missing finished_at line means the EXIT
# trap did not run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB="$ROOT/bin/lib/deploy-stage-report.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_eq() {
  local got="$1"
  local want="$2"
  local label="$3"
  if [[ "$got" != "$want" ]]; then
    fail "${label}: got [${got}] want [${want}]"
  fi
}

stage_field() {
  local file="$1"
  local name="$2"
  local column="$3"
  awk -F '\t' -v name="$name" -v column="$column" '
    $1 == "stage" && $2 == name { print $column; found = 1 }
    END { if (!found) exit 1 }
  ' "$file"
}

field() {
  local file="$1"
  local key="$2"
  awk -F ': ' -v key="$key" '$1 == key { print substr($0, length(key) + 3); found = 1; exit } END { if (!found) exit 1 }' "$file"
}

new_dir() {
  mktemp -d
}

write_stub() {
  local path="$1"
  local body="$2"
  printf '%s\n' "$body" >"$path"
  chmod +x "$path"
}

# shellcheck source=lib/deploy-stage-report.sh
source "$LIB"

elapsed="$(deploy_report_format_elapsed 1000000000 2500000000)"
assert_eq "$elapsed" "1.500" "format 1.500s"
elapsed="$(deploy_report_format_elapsed 5000 1000)"
assert_eq "$elapsed" "0.000" "format clamps negative"

grep -q 'deploy_report_run_stage "Traefik edge"' "$ROOT/bin/deploy-all.sh" || fail "deploy-all missing Traefik stage"
grep -q 'trap deploy_report_on_exit EXIT' "$ROOT/bin/deploy-all.sh" || fail "deploy-all missing report trap"
grep -q 'deploy_report_run_stage "v2 shared data plane"' "$ROOT/bin/restart-all.sh" || fail "restart-all missing v2 stage"
grep -q 'trap deploy_report_on_exit EXIT' "$ROOT/bin/restart-all.sh" || fail "restart-all missing report trap"
if grep -q 'deploy-traefik.sh' "$ROOT/bin/restart-all.sh"; then
  fail "restart-all should not gain a Traefik stage"
fi

# Sets ORCH_EXIT. Stage logs go to <dir>/orchestrator.log so the exit code
# is not mixed with the report path lines.
run_orchestrator() {
  local kind="$1"
  local continue_on_warn="$2"
  local dir="$3"
  shift 3

  export FLUX_DEPLOY_REPORT_DIR="$dir"
  export REPO_ROOT="$dir/repo"
  export ENV_LABEL="test"
  export CONTINUE_ON_WARN="$continue_on_warn"
  mkdir -p "$REPO_ROOT"

  set +e
  bash -c '
    set -euo pipefail
    source "$1"
    kind="$2"
    continue_flag="$3"
    shift 3
    export CONTINUE_ON_WARN="$continue_flag"
    deploy_report_begin "$kind"
    trap deploy_report_on_exit EXIT
    while [[ $# -ge 2 ]]; do
      deploy_report_run_stage "$1" "$2"
      shift 2
    done
  ' bash "$LIB" "$kind" "$continue_on_warn" "$@" >"$dir/orchestrator.log" 2>&1
  ORCH_EXIT=$?
  set -e
}

only_report() {
  local dir="$1"
  local kind="$2"
  local files=()
  local path
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    files+=("$path")
  done < <(find "$dir" -maxdepth 1 -type f -name "${kind}-*.txt" | sort)
  if [[ ${#files[@]} -ne 1 ]]; then
    fail "expected one ${kind} report in ${dir}, found ${#files[@]}"
  fi
  printf '%s' "${files[0]}"
}

echo "case: fail-fast"
dir="$(new_dir)"
ok="$dir/ok.sh"
bad="$dir/bad.sh"
slow="$dir/slow.sh"
write_stub "$ok" '#!/bin/bash
exit 0'
write_stub "$bad" '#!/bin/bash
exit 17'
write_stub "$slow" '#!/bin/bash
sleep 0.3
exit 0'
run_orchestrator deploy-all 0 "$dir" alpha "$ok" beta "$bad" gamma "$ok"
assert_eq "$ORCH_EXIT" "17" "fail-fast exit"
report="$(only_report "$dir" deploy-all)"
assert_eq "$(stage_field "$report" alpha 3)" "0" "alpha exit"
assert_eq "$(stage_field "$report" alpha 5)" "ok" "alpha result"
assert_eq "$(stage_field "$report" beta 3)" "17" "beta exit"
assert_eq "$(stage_field "$report" beta 5)" "failed" "beta result"
if awk -F '\t' '$1=="stage" && $2=="gamma"' "$report" | grep -q .; then
  fail "gamma ran during fail-fast"
fi
assert_eq "$(field "$report" overall_exit)" "17" "fail-fast overall_exit"
assert_eq "$(field "$report" result)" "failed" "fail-fast result"
assert_eq "$(field "$report" stopped_early)" "1" "fail-fast stopped_early"
assert_eq "$(field "$report" stages_recorded)" "2" "fail-fast stages_recorded"
assert_eq "$(field "$report" stages_failed)" "1" "fail-fast stages_failed"
assert_eq "$(field "$report" continue_on_warn)" "0" "fail-fast continue flag"
assert_eq "$(grep -c '^finished_at:' "$report")" "1" "one footer"
[[ "$(stage_field "$report" alpha 4)" =~ ^[0-9]+\.[0-9]{3}$ ]] || fail "alpha elapsed format"
[[ "$(field "$report" overall_elapsed_s)" =~ ^[0-9]+\.[0-9]{3}$ ]] || fail "overall elapsed format"
[[ "$(basename "$report")" =~ ^deploy-all-[0-9]{8}T[0-9]{6}Z-[0-9]+\.txt$ ]] || fail "report filename: $(basename "$report")"

echo "case: continue on warn"
dir="$(new_dir)"
ok="$dir/ok.sh"
bad="$dir/bad.sh"
write_stub "$ok" '#!/bin/bash
exit 0'
write_stub "$bad" '#!/bin/bash
exit 17'
run_orchestrator deploy-all 1 "$dir" alpha "$ok" beta "$bad" gamma "$ok"
assert_eq "$ORCH_EXIT" "0" "continue exit stays 0"
report="$(only_report "$dir" deploy-all)"
assert_eq "$(stage_field "$report" beta 3)" "17" "continue records real exit"
assert_eq "$(stage_field "$report" gamma 3)" "0" "continue ran later stage"
assert_eq "$(field "$report" overall_exit)" "0" "continue overall_exit"
assert_eq "$(field "$report" result)" "continued_with_failures" "continue result"
assert_eq "$(field "$report" stopped_early)" "0" "continue did not stop early"
assert_eq "$(field "$report" stages_recorded)" "3" "continue recorded all"
assert_eq "$(field "$report" continue_on_warn)" "1" "continue flag"

echo "case: elapsed time"
dir="$(new_dir)"
slow="$dir/slow.sh"
write_stub "$slow" '#!/bin/bash
sleep 0.3
exit 0'
run_orchestrator restart-all 0 "$dir" slow "$slow"
assert_eq "$ORCH_EXIT" "0" "elapsed case exit"
report="$(only_report "$dir" restart-all)"
ms="$(awk -F '\t' '$1=="stage" && $2=="slow" { split($4, a, "."); print a[1] * 1000 + a[2] }' "$report")"
if [[ "$ms" -lt 200 ]]; then
  fail "slow stage elapsed ${ms}ms, want >= 200"
fi
assert_eq "$(field "$report" kind)" "restart-all" "restart kind"
assert_eq "$(field "$report" result)" "ok" "elapsed case result"

echo "case: failure before stages"
dir="$(new_dir)"
export FLUX_DEPLOY_REPORT_DIR="$dir"
export REPO_ROOT="$dir/repo"
export ENV_LABEL="test"
export CONTINUE_ON_WARN=0
mkdir -p "$REPO_ROOT"
set +e
bash -c '
  set -euo pipefail
  source "$1"
  deploy_report_begin "deploy-all"
  trap deploy_report_on_exit EXIT
  exit 9
' bash "$LIB"
code=$?
set -e
assert_eq "$code" "9" "pre-stage exit"
report="$(only_report "$dir" deploy-all)"
assert_eq "$(field "$report" stages_recorded)" "0" "pre-stage recorded"
assert_eq "$(field "$report" overall_exit)" "9" "pre-stage overall"
assert_eq "$(field "$report" result)" "failed" "pre-stage result"
assert_eq "$(field "$report" note)" "no stage results recorded" "pre-stage note"
if awk -F '\t' '$1=="stage"' "$report" | grep -q .; then
  fail "pre-stage report should not have stage rows"
fi

echo "OK: deploy stage report"
