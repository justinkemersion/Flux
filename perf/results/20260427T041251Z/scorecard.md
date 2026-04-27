# Flux Gateway Scorecard

**Flux Score:** **81.9** / 100  
**Verdict:** **Safe but needs tuning** (WARN)

## Tier 0 — Hard fail

**PASS** (no uncontrolled 5xx burst, no p99/max tail > 8s in this summary, no tenant flag)

## Tier scores (remaining weights)

| Tier | Weight | Score | Notes |
|------|--------|------:|-------|
| Correctness | 40 | 36.9 | unexpected handling: 0.308% → -3.1 (cap 40) |
| Latency | 30 | 30 | — |
| Load shedding | 20 | 5 | no 503 shedding but p95>3s under overload → -15 (queueing) |
| Stability | 10 | 10 | No stability side-signals (set STABILITY_* env to penalize). |

## Primary issue

Largest automated deduction: load shedding (15.0 pts).

## Caveats

- No baseline summary — Tier 2 tail-vs-baseline comparison skipped.
- Tenant/JWT invariant checks require explicit probes (TENANT_INVARIANT_FAIL=1 if violated).

---
*Deductions are capped per tier. Tune thresholds in `perf/k6/score-run.mjs` as you gather more labeled runs.*
