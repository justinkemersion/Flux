# v2 Gateway Testing: Accomplishments and Current State

This note captures what was accomplished across the v2 gateway validation work, including setup shims, diagnostics, k6 methodology, concrete run commands, and what we now know about current system limits.

---

## 1) What we validated end-to-end

We successfully validated the gateway path for a Web UI-created project host:

- `api.v2-shared-test-proj.6715239.vsl-base.com`
- Gateway entry tested at `http://127.0.0.1:4000` with explicit `Host` header routing.

Core proof points achieved:

1. **Tenant resolution works** for `api.<slug>.<hash>.<base-domain>` hostnames.
2. **Gateway mode gate works** (`v1_dedicated` blocked, `v2_shared` routed).
3. **JWT signature contract works** once gateway and PostgREST secrets are aligned.
4. **Role claim contract works** once tenant role/schema exist in Postgres.
5. **Proxy path works** (200 OpenAPI through gateway with `x-tenant-id` and `x-tenant-role` headers).

---

## 2) Explicit shims required (current dev reality)

Because full v2 provisioning is not yet the default path, we used controlled manual shims:

1. **Catalog mode flip**
   - Updated project in flux-system DB to `projects.mode = 'v2_shared'`.
2. **JWT secret alignment**
   - Ensured gateway `FLUX_GATEWAY_JWT_SECRET` == upstream PostgREST `PGRST_JWT_SECRET`.
3. **Tenant DB role/schema bootstrap**
   - Created/verified `t_<shortid>_role` and `t_<shortid>_api` grants/search path for the tenant.

Without these, observed errors were expected:

- `project mode "v1_dedicated" is not routed through this gateway`
- `JWSError JWSInvalidSignature`
- `role "t_<shortid>_role" does not exist`

---

## 3) Current architecture status (important)

- **Clarification (2026-05):** the Drizzle catalog default for *new* `projects.mode` rows is **`v2_shared`** (`apps/dashboard/src/db/schema.ts`). The bullet below refers to this **historical manual test path**, not the current DB default.
- **Default provisioning remains v1-oriented** for Web UI-created projects in this workflow.
- Gateway v2 route behavior is functioning, but **v2 data-plane provisioning is still partially manual** in this test path.
- Pointing `FLUX_POSTGREST_POOL_URL` at a single tenant `-api` container is valid for smoke/integration, but does **not** yet represent final shared-pool v2 behavior.

---

## 4) k6 testing workflow improvements made

We improved both reliability and observability in the perf harness:

1. **Tail scoring fix in `score-run.mjs`**
   - Tail selection now uses `p(99)` -> `p(95)` -> `max` when `p(99)` is missing in k6 summary export.
   - This removed false Tier-0 failures from single outlier max values.

2. **Loopback Host safety checks**
   - `arch-truth-test.js` now fails fast if loopback base URL is used without `KNOWN_HOST`/`HOST`.
   - `overload-smoke.js` similarly validates host config on loopback.

3. **Status decomposition metrics added**
   - Added per-scenario status rates for:
     - `resolver_hot`: 200/404/429/503/504/other
     - `upstream_light`: 200/404/429/503/504/other
     - `overload_shed`: 200/404/429/503/504/other
   - This made triage immediate without guesswork.

---

## 5) Canonical commands used

Resolver hot test pattern:

```bash
TRUTH_SCENARIOS=resolver_hot \
UPSTREAM_BASE=http://127.0.0.1:4000 \
KNOWN_HOST=api.v2-shared-test-proj.6715239.vsl-base.com \
RESOLVER_HOT_RATE=<rate> \
k6 run perf/k6/scenarios/arch-truth-test.js
```

Gateway status census from logs:

```bash
docker logs --since 3m flux-node-gateway 2>&1 > /tmp/gw-after.log
rg -o '"status":[0-9]{3}|status=[0-9]{3}' /tmp/gw-after.log \
| rg -o '[0-9]{3}' \
| sort | uniq -c | sort -nr
```

Host-scoped status census:

```bash
rg 'api.v2-shared-test-proj.6715239.vsl-base.com' /tmp/gw-after.log \
| rg -o '"status":[0-9]{3}|status=[0-9]{3}' \
| rg -o '[0-9]{3}' \
| sort | uniq -c | sort -nr
```

---

## 6) What the data now clearly says

### Correctness/routing

- `404` dropped to `0%` in resolver-hot ladder runs.
- This confirms Host-based tenant resolution is correct under tested conditions.

### Failure mode at load

- Non-200 responses are now dominated by `503` and `504`.
- Log census confirmed:
  - `200`: 5402
  - `503`: 345
  - `504`: 254
- Therefore, current issues are **capacity/backpressure + timeout behavior**, not tenant lookup failures.

### Knee point found

Rate sweep results show a clear knee:

- `50 rps`: clean (`100% 200`, p95 ~10ms)
- `100 rps`: beginning stress (~91.7% 200, some 503/504, p95 ~2.7s)
- `150 rps`: heavy shedding (~61% 200, ~35% 503)
- `200 rps`: shed-dominant (~46% 200, ~51% 503)

Interpretation: practical knee for this exact path/config is between ~50 and ~100 rps.

---

## 7) Where we are now

We are past routing/JWT/role correctness blockers and are now in **performance tuning phase**:

1. Validate timeout tradeoff (`FLUX_POSTGREST_TIMEOUT_MS`) with controlled A/B runs.
2. Tune inflight/adaptive limiter behavior against target success rate.
3. Establish target SLO (e.g., `%200` and p95) and tune toward it.
4. Keep Host/mode/test path fixed while iterating so comparisons stay valid.

---

## 8) Suggested immediate next test plan

1. Keep resolver-hot scenario and host fixed.
2. Run rate ladder around knee (`60, 70, 80, 90, 100`) with status metrics.
3. Repeat ladder for each timeout setting (baseline, +500ms, +1000ms).
4. Compare `%200`, `%503`, `%504`, and p95; pick the best policy tradeoff.

This gives a defensible performance envelope while v2 provisioning continues to mature.

