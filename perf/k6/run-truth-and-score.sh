#!/usr/bin/env bash
# Run arch-truth-test + overload-smoke, then score-run (writes scorecard.md + scorecard.json).
# Inherits env: UPSTREAM_BASE, KNOWN_HOST, LOAD_TEST_*, FLUX_BASE_DOMAIN, TRUTH_*, etc.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STAMP="${STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
OUT="${RESULTS_DIR:-$ROOT_DIR/perf/results}/$STAMP"

mkdir -p "$OUT"

# gateway.js scenarios read BASE_URL / HOST; arch-truth uses UPSTREAM_BASE / KNOWN_HOST
if [[ -n "${UPSTREAM_BASE:-}" ]]; then export BASE_URL="${BASE_URL:-$UPSTREAM_BASE}"; fi
if [[ -n "${KNOWN_HOST:-}" ]]; then export HOST="${HOST:-$KNOWN_HOST}"; fi

if ! command -v k6 >/dev/null 2>&1; then
  echo "[run-truth-and-score] k6 not installed" >&2
  exit 1
fi

echo "[run-truth-and-score] output directory: $OUT"

echo "[run-truth-and-score] k6 arch-truth-test"
k6 run "$ROOT_DIR/perf/k6/scenarios/arch-truth-test.js" \
  --summary-export "$OUT/arch-truth.summary.json" \
  >"$OUT/arch-truth.stdout.txt" 2>&1 || true

echo "[run-truth-and-score] k6 overload-smoke"
k6 run "$ROOT_DIR/perf/k6/scenarios/overload-smoke.js" \
  --summary-export "$OUT/overload.summary.json" \
  >"$OUT/overload-smoke.stdout.txt" 2>&1 || true

echo "[run-truth-and-score] score-run"
node "$ROOT_DIR/perf/k6/score-run.mjs" \
  --summary "$OUT/arch-truth.summary.json" \
  --overload-summary "$OUT/overload.summary.json" \
  --out "$OUT/scorecard.md" \
  >/dev/null

echo "[run-truth-and-score] done: $OUT/scorecard.md and $OUT/scorecard.json"
