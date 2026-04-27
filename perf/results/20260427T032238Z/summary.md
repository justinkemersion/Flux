# k6 Matrix Summary

- Run directory: `/home/justin/Projects/flux/perf/results/20260427T032238Z`
- Generated at: 2026-04-27T03:46:31.183Z

| Scenario | Requests | p95 (ms) | max (ms) | failed % | 429 % | 503 % | 504 % | other 5xx % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| cold-start | 312,429 | 0.00 | 0.00 | 100.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| db-slow | 71,246 | 0.00 | 2616.35 | 99.99 | 0.00 | 0.00 | 0.00 | 0.00 |
| hot-tenant | 22,590 | 10001.08 | 10006.87 | 91.16 | 0.00 | 0.00 | 0.00 | 0.00 |
| overload | 48,912 | 0.00 | 0.00 | 100.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| random-host | 46,491 | 10000.82 | 10008.98 | 31.43 | 0.00 | 0.00 | 0.00 | 0.00 |
| rate-limit-calibration | 5,792 | 4720.66 | 10001.00 | 0.50 | 0.00 | 0.00 | 0.00 | 0.00 |
| redis-down | 377,934 | 0.00 | 0.00 | 100.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| warm-steady | 29,915 | 10001.11 | 10023.34 | 93.14 | 0.00 | 0.00 | 0.00 | 0.00 |

## Notes
- Prioritize `other 5xx` regressions first; they indicate non-shedding failures.
- In overload runs, a healthy system sheds with `503` before tail-latency collapse.
