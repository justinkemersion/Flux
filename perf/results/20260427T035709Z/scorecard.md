# Flux Gateway Scorecard

**Flux Score:** **90** / 100  
**Verdict:** **Production ready** (PASS)

## Tier 0 — Hard fail

**PASS** (no uncontrolled 5xx burst, no p99/max tail > 8s in this summary, no tenant flag)

## Tier scores (remaining weights)

| Tier | Weight | Score | Notes |
|------|--------|------:|-------|
| Correctness | 40 | 40 | — |
| Latency | 30 | 20 | tail 2217ms > 2000ms → -10 (-10 per +500ms bucket, ceil; uses p(99) or max if absent) |
| Load shedding | 20 | 20 | No overload summary provided — shedding not measured (no deduction; caveat in verdict). |
| Stability | 10 | 10 | No stability side-signals (set STABILITY_* env to penalize). |

## Primary issue

Largest automated deduction: latency (10.0 pts).

## Caveats

- Tier 3 shedding was not evaluated (no overload summary).
- No baseline summary — Tier 2 tail-vs-baseline comparison skipped.
- Tenant/JWT invariant checks require explicit probes (TENANT_INVARIANT_FAIL=1 if violated).

---
*Deductions are capped per tier. Tune thresholds in `perf/k6/score-run.mjs` as you gather more labeled runs.*
