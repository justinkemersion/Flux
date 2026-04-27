# Arch truth test run

- Timestamp: `20260427T035709Z`
- Script: `perf/k6/scenarios/arch-truth-test.js`
- Status: completed (exit 0)

## Configuration

- `UPSTREAM_BASE`: `https://api.test-app.ba85154.vsl-base.com`
- `KNOWN_HOST`: `api.test-app.ba85154.vsl-base.com`
- `TRUTH_SCENARIOS`: `gateway_only`, `resolver_hot`, `resolver_cold`, `upstream_light`
- Stagger: 22s between scenarios; 18s duration each; rates 15–25 iters/s
- Load-test headers: `LOAD_TEST_HEADER=true`, `LOAD_TEST_KEY` set

## Outcome (from k6 summary)

- `http_req_failed`: 0%
- `http_req_duration` p(95): ~186 ms
- Checks: all four scenario checks passed (gateway 2xx, hot ok, cold 404/200, light ok)

Artifacts: `arch-truth.summary.json` (machine-readable totals).
