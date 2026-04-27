# Gateway Load Testing

This runbook executes the Flux gateway stress matrix against the current `@flux/gateway` runtime. It is built to validate resolver cache behavior, Redis fail-open logic, overload shedding, and timeout handling.

## Prerequisites

- `k6` installed and available on `PATH`.
- Gateway reachable at `BASE_URL` (default: `http://localhost:4000`).
- A valid tenant host in `HOST` format like `myapp-a1b2c3d.flux.localhost`.
- Optional Docker access if you want automated `cold-start` and `redis-down` disruptions.

## Scenario Order

1. `rate-limit-calibration`
2. `warm-steady`
3. `cold-start`
4. `redis-down`
5. `db-slow`
6. `hot-tenant`
7. `random-host`
8. `overload`

## Scripts

- Shared harness: `perf/k6/lib/gateway.js`
- Host traffic models: `perf/k6/lib/hosts.js`
- Scenario files: `perf/k6/scenarios/*.js`
- Matrix runner: `perf/k6/run-matrix.sh`
- **Architecture “truth” test** (isolate gateway vs resolver vs PostgREST/DB): `perf/k6/scenarios/arch-truth-test.js`

### Architecture truth test (`arch-truth-test.js`)

This script runs named scenarios in parallel (optional stagger) so you can slice metrics by `arch_scenario`, `arch_layer`, and `mix` tags.

| Scenario | Intent |
|----------|--------|
| `gateway_only` | Minimal path on `GATEWAY_BASE` (often `/` or `/health`) — tune `TRUTH_PATH_GATEWAY` |
| `resolver_hot` | Same tenant repeatedly (`KNOWN_HOST`) — hot cache / routing |
| `resolver_cold` | Random `<slug>-<hash>.<FLUX_BASE_DOMAIN>` Host — cold resolver / single-flight |
| `upstream_light` | Light read on `TRUTH_PATH_UPSTREAM_LIGHT` |
| `upstream_heavy` | Heavier read on `TRUTH_PATH_UPSTREAM_HEAVY` |
| `overload_shed` | Ramp until you see `503` vs pure timeouts |

Important:

- Point **`UPSTREAM_BASE`** (or `BASE_URL`) at the **edge URL** you are testing (gateway or pool URL). For Host-based routing, set **`KNOWN_HOST`** (or `HOST`) to the tenant host; for cold resolver traffic, set **`FLUX_BASE_DOMAIN`** (e.g. `vsl-base.com`). Wildcard TLS must allow the cold host if you override `Host`.
- Set **`TRUTH_PATH_UPSTREAM_LIGHT`** (and optionally `TRUTH_PATH_UPSTREAM_HEAVY`) to a real table path (e.g. `/rest/v1/your_table?limit=1`) — default `/` is only a smoke default.
- Run a **subset** while tuning: `TRUTH_SCENARIOS=gateway_only,upstream_light`
- Lower rates for smoke: e.g. `GATEWAY_ONLY_RATE=10` `GATEWAY_ONLY_DURATION=30s`

```bash
pnpm perf:gateway:truth
# or
TRUTH_SCENARIOS=gateway_only,upstream_light \
UPSTREAM_BASE="https://api.example.com" \
KNOWN_HOST="api.example.com" \
TRUTH_PATH_UPSTREAM_LIGHT="/rest/v1/items?limit=1" \
k6 run perf/k6/scenarios/arch-truth-test.js
```

## Quick Start

Run the full matrix:

```bash
bash perf/k6/run-matrix.sh
```

Remote API (PostgREST URL, no `/health`) plus Cloudflare bypass headers:

```bash
SKIP_DISRUPTIVE=1 \
LOAD_TEST_HEADER=true \
LOAD_TEST_KEY=your-secret \
BASE_URL="https://api.<slug>.<hash>.vsl-base.com" \
HOST="api.<slug>.<hash>.vsl-base.com" \
bash perf/k6/run-matrix.sh
```

The health gate tries `BASE_URL/health` first, then `BASE_URL/`, using the same `x-load-test` headers when `LOAD_TEST_HEADER=true`.

Run one scenario directly:

```bash
BASE_URL="http://localhost:4000" \
HOST="myapp-a1b2c3d.flux.localhost" \
k6 run perf/k6/scenarios/warm-steady.js
```

Skip container disruptions:

```bash
SKIP_DISRUPTIVE=1 bash perf/k6/run-matrix.sh
```

## Scenario Expectations

- `warm-steady`: stable throughput with bounded tail latency and low non-shedding 5xx.
- `cold-start`: brief latency spike is acceptable, sustained `504` is not.
- `redis-down`: small latency increase is acceptable; widespread `500` class is not.
- `db-slow`: bounded degradation with controlled `504`; no runaway fanout symptoms.
- `hot-tenant`: moderate degradation only; avoid global tail-latency collapse.
- `random-host`: memory should plateau after cache churn; not monotonic growth.
- `overload`: `503` should rise as intentional shedding before full latency collapse.

## Metrics To Capture

From k6:

- `http_req_duration` p50/p95/p99
- `http_req_failed`
- status buckets: `status_429`, `status_503`, `status_504`, `status_other_5xx`

From runtime:

- Gateway CPU, RSS/heap, event-loop lag
- Postgres active connections and query latency
- Redis ops/sec and latency

## Results and Baselines

- Matrix outputs are written to `perf/results/<timestamp>/`.
- Each scenario writes:
  - `<scenario>.summary.json`
  - `<scenario>.log`
- Consolidated run notes are written to:
  - `perf/results/<timestamp>/baseline.md`
- Generate an at-a-glance markdown table from all scenario summaries:
  - `pnpm perf:gateway:summary`
  - or `node perf/k6/summarize-results.mjs perf/results/<timestamp>`
- Summary output path:
  - `perf/results/<timestamp>/summary.md`

If prerequisites fail, the baseline file is still created with a `blocked` status so missing setup is explicit.

## Gateway scorecard (PASS / FAIL + numeric score)

Automated scorecard from k6 `--summary-export` JSON: [`perf/k6/score-run.mjs`](../perf/k6/score-run.mjs).

- **Tier 0 (hard fail):** `other_5xx` rate > 0.5%, tail > 8s (`p(99)` if present else `max`), optional `TENANT_INVARIANT_FAIL=1`.
- **Tier 1 (40 pts):** unexpected responses from `expected_status` or `checks`; env flags `RATE_LIMIT_LEAK=1`, `MODE_ISOLATION_FAIL=1`.
- **Tier 2 (30 pts):** p50 / p95 / p99 vs targets (ceil bucket penalties); optional `--baseline-summary` for 2× p95 regression; `TAIL_COLLAPSE=1`.
- **Tier 3 (20 pts):** optional `--overload-summary` for 503 vs latency; otherwise **not measured** (full points, caveat in output).
- **Tier 4 (10 pts):** `STABILITY_SPIKE=1`, `COLD_REGRESSION=1` when you have side signals.

```bash
node perf/k6/score-run.mjs \
  --summary perf/results/<run>/arch-truth.summary.json \
  --overload-summary perf/results/<run>/overload.summary.json \
  --out perf/results/<run>/scorecard.md

pnpm perf:gateway:score -- --summary perf/results/<run>/arch-truth.summary.json
```

CI gate (exit 2 if score < 80 after Tier 0 passes):

```bash
node perf/k6/score-run.mjs --summary run.json --fail-below 80
```
