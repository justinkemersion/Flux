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
