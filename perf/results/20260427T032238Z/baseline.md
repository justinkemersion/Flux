# Gateway Baseline Run

- Timestamp: 20260427T032238Z
- Base URL: `https://api.test-app.ba85154.vsl-base.com`

## rate-limit-calibration

- Summary: `rate-limit-calibration.summary.json`
- Raw log: `rate-limit-calibration.log`

## warm-steady

- Summary: `warm-steady.summary.json`
- Raw log: `warm-steady.log`

## cold-start

- Summary: `cold-start.summary.json`
- Raw log: `cold-start.log`

## redis-down

- Summary: `redis-down.summary.json`
- Raw log: `redis-down.log`

## db-slow

- Summary: `db-slow.summary.json`
- Raw log: `db-slow.log`

## hot-tenant

- Summary: `hot-tenant.summary.json`
- Raw log: `hot-tenant.log`

## random-host

- Summary: `random-host.summary.json`
- Raw log: `random-host.log`

## overload

- Summary: `overload.summary.json`
- Raw log: `overload.log`

## Interpretation

- Check each `.summary.json` for p95/p99 latency and status buckets.
- Regressions to prioritize: rising `status_other_5xx`, sustained `504`, memory growth under random-host.
- Overload is healthy when `503` rises before latency collapse.
