# Flux improvement review and testing roadmap

**Date:** 2026-05-04  
**Scope:** Codebase review, internal notes, and existing unit tests — not production telemetry or exhaustive manual QA.  
**Baseline:** `v2_shared` appears operational in recent tests; many edge paths and failure modes are not yet covered by automation.

---

## 1. Context

Flux is a monorepo (pnpm workspaces) providing a control plane (dashboard), CLI, gateway, and execution engines (`v1_dedicated` vs `v2_shared`). This document records **what already works well**, **gaps** (CI, tests, perf, docs), and a **prioritized backlog** plus a **v2_shared-focused test matrix**.

Canonical architecture and threat model: [docs/pages/architecture/flux-v2-architecture.md](./pages/architecture/flux-v2-architecture.md).  
Operator and client-app pitfalls for pooled tenants: [AGENTS.md](../AGENTS.md), [docs/pages/guides/nextjs.md](./pages/guides/nextjs.md).

---

## 2. What is in good shape

- **Mode dispatch:** [apps/dashboard/src/lib/provisioning-engine.ts](../apps/dashboard/src/lib/provisioning-engine.ts) routes `v1_dedicated` to Docker provisioning and `v2_shared` to shared-cluster provisioning with explicit cleanup on catalog failure.
- **Pooled SQL push:** [apps/dashboard/src/lib/pooled-push.ts](../apps/dashboard/src/lib/pooled-push.ts) uses a transaction, `SET LOCAL search_path`, `statement_timeout`, `NOTIFY pgrst, 'reload schema'`, and outer timeout — covered by mocked client tests in [apps/dashboard/src/lib/pooled-push.test.ts](../apps/dashboard/src/lib/pooled-push.test.ts).
- **Gateway → upstream contract:** [packages/gateway/src/proxy.test.ts](../packages/gateway/src/proxy.test.ts) asserts forwarding of auth and profile headers.
- **JWT issuance (gateway):** [packages/gateway/src/jwt-issuer.test.ts](../packages/gateway/src/jwt-issuer.test.ts).
- **CLI / SDK:** [packages/cli/src](../packages/cli/src) and [packages/sdk/src/url-infer.test.ts](../packages/sdk/src/url-infer.test.ts) have focused tests.
- **Load methodology:** [perf/k6/](../perf/k6/) scenarios and scoring scripts; gateway validation narrative in [notes-for-justin/v2-gateway-testing-accomplishments-and-current-state.md](../notes-for-justin/v2-gateway-testing-accomplishments-and-current-state.md).

---

## 3. Reliability and operations

| Item | Detail |
|------|--------|
| **CI** | [.github/workflows/ci.yml](../.github/workflows/ci.yml) runs `pnpm test` on push/PR. Optional **v2-gateway-smoke** job on push to `main`/`master` when `FLUX_SMOKE_CI=true` (see job `if:`). Manual smoke: [.github/workflows/v2-gateway-smoke.yml](../.github/workflows/v2-gateway-smoke.yml). |
| **Monorepo test entry** | Root [package.json](../package.json) defines `pnpm test` as `pnpm -r --if-present test`, so only workspaces that declare a `test` script participate. `@flux/core` and `@flux/engine-v1` omit `test` until they have real suites (previously they shipped a stub that always exited 1). |
| **Deploy scripts** | Shared v2 bootstrap is tied to [bin/deploy-v2-shared.sh](../bin/deploy-v2-shared.sh) (global `authenticator` / `anon`, cluster hooks). After changing [packages/engine-v2/src/index.ts](../packages/engine-v2/src/index.ts), re-verify deploy ordering and PostgREST reload behavior on a staging cluster. |

---

## 4. Performance and limits

From [notes-for-justin/v2-gateway-testing-accomplishments-and-current-state.md](../notes-for-justin/v2-gateway-testing-accomplishments-and-current-state.md):

- Tenant **resolution and JWT correctness** were validated; under load, non-200s were dominated by **503/504** (capacity, timeouts, backpressure), not 404s from bad Host routing.
- A practical **knee** for the tested configuration fell roughly between **50 and 100 rps**.

**Improvement area:** tune `FLUX_POSTGREST_TIMEOUT_MS`, gateway limiters/inflight settings, and upstream capacity — treat as **SLO / perf engineering**, not routing bugs. Continue using the k6 ladder methodology in that note for A/B comparisons.

---

## 5. Security and isolation (code vs tests)

| Topic | In code | Automated tests |
|-------|---------|-----------------|
| Tenant schema / role bootstrap | [packages/engine-v2/src/index.ts](../packages/engine-v2/src/index.ts) (`buildTenantBootstrapSql`, `provisionProject`) | Unit tests on SQL builders (see [packages/engine-v2/src/index.test.ts](../packages/engine-v2/src/index.test.ts)); no DB integration in CI yet |
| ShortId collision | `TenantShortIdCollisionError`, `checkTenantOwnership` | Unit coverage for identity derivation; collision path ideally integration-tested with Postgres |
| Pooled push `service_role` JWT | `pooled-push-route.ts` + thin `route.ts` | Route handler tests with mocked `loadProject` / `executePooledPush` |
| SQL size limits | `POOLED_PUSH_MAX_SQL_BYTES` in `pooled-push-validators.ts` | Covered by `pooled-push-validators.test.ts` |
| Cluster hooks (`flux_postgrest_config`, `flux_set_tenant_context`) | `buildClusterBootstrapSql` | Substring / snapshot assertions in engine-v2 unit tests |

---

## 6. Documentation drift (reconciled)

**Internal note** [notes-for-justin/v2-gateway-testing-accomplishments-and-current-state.md](../notes-for-justin/v2-gateway-testing-accomplishments-and-current-state.md) §3 states that “default provisioning remains v1-oriented” for a **specific manual gateway test workflow** (catalog row flipped to `v2_shared`, shims for secrets and roles). That described **how that experiment was set up**, not necessarily the Drizzle default for brand-new rows.

**Current catalog default for new rows:** [apps/dashboard/src/db/schema.ts](../apps/dashboard/src/db/schema.ts) sets `projects.mode` **not null** with **default `"v2_shared"`**.

**Legacy semantics:** [README.md](../README.md) still documents `NULL` mode as legacy, treated as **`v1_dedicated`** everywhere.

**Takeaway for operators:** New dashboard-created projects default to **v2_shared** at the DB layer. Older rows may still be `NULL` or `v1_dedicated`. When reading the gateway testing note, treat §3 as **historical lab setup**, not the product default in current schema. Consider updating that note with a one-line clarification to avoid confusion.

---

## 7. Prioritized improvement backlog

| Priority | Item |
|----------|------|
| **P0** | Keep CI green: `pnpm test` at repo root; fix regressions in tested packages first. |
| **P1** | Expand **@flux/engine-v2** tests: deprovision SQL, env edge cases done; optional Postgres integration (Testcontainers or CI service container) for `provisionProject` / `checkTenantOwnership`. |
| **P2** | **Dashboard push route:** `runPooledPushPost` in `pooled-push-route.ts` + `pooled-push-route.test.ts` cover bearer, hash, SQL size, mode split, JWT/role, success, PG errors, and timeout → 504. |
| **P3** | **E2E:** [`bin/e2e-v2-shared-smoke.sh`](../bin/e2e-v2-shared-smoke.sh). **CI:** default workflow stays test-only; opt-in push job when repo variable `FLUX_SMOKE_CI=true` + secrets `FLUX_SMOKE_GATEWAY_URL` / `FLUX_SMOKE_KNOWN_HOST` (optional `FLUX_SMOKE_BEARER`). **Manual:** workflow [`v2-gateway-smoke.yml`](../.github/workflows/v2-gateway-smoke.yml) (`workflow_dispatch`). Playwright still optional. |
| **P4** | **Perf SLOs:** Define target `%200` / p95; iterate gateway timeout and limiter settings with fixed k6 scenarios. |

**Product / tech debt:** [packages/gateway/src/app.ts](../packages/gateway/src/app.ts) documents a **TODO** for optional **v1** routing through the gateway — decide whether to implement, defer, or document as out of scope.

---

## 8. Suggested test matrix (v2_shared)

| Scenario | Intent |
|----------|--------|
| Provision new tenant | Schema + role exist; comment `tenant:<uuid>`; grants present |
| Repair / re-run provision | Idempotent DDL; connection limit and timeouts reapplied |
| Deprovision / delete project | `DROP SCHEMA` + role removal; catalog eviction |
| CLI `flux push` | End-to-end against pooled push API with valid `service_role` JWT |
| Gateway Host resolution | Correct tenant for `api.<slug>.<hash>.<domain>` (and triple-dash host if used) |
| Gateway JWT | Valid HS256; wrong secret → 401 path |
| Wrong mode | `v1_dedicated` project hitting v2 push route → 400 per route contract |
| ShortId collision | Two UUIDs same 12-hex prefix → `TenantShortIdCollisionError` (extremely rare) |
| Large SQL | Reject or bound behavior per `MAX_SQL_BYTES` |
| Long-running SQL | `statement_timeout` / outer push timeout → 504 or PG error surfaced |
| PostgREST visibility | After DDL, `NOTIFY pgrst, 'reload schema'` and/or config reload exposes new objects |
| Gateway smoke | `FLUX_SMOKE_KNOWN_HOST` + `bin/e2e-v2-shared-smoke.sh` returns 2xx on `GET /` through the real stack |

---

## 9. Related files (quick index)

| Path | Role |
|------|------|
| [packages/engine-v2/src/index.ts](../packages/engine-v2/src/index.ts) | Shared tenant DDL, cluster bootstrap SQL, `buildDeprovisionSql` |
| [apps/dashboard/src/lib/pooled-push-validators.ts](../apps/dashboard/src/lib/pooled-push-validators.ts) | Hash/body/SQL size / role / schema helpers for pooled push |
| [apps/dashboard/src/lib/pooled-push-route.ts](../apps/dashboard/src/lib/pooled-push-route.ts) | Shared POST handler + injectable deps (tests + route) |
| `apps/dashboard/app/api/projects/[slug]/push/route.ts` | Pooled push HTTP API (wires real DB + `executePooledPush`) |
| [apps/dashboard/src/lib/pooled-push.ts](../apps/dashboard/src/lib/pooled-push.ts) | Transactional execution |
| [bin/e2e-v2-shared-smoke.sh](../bin/e2e-v2-shared-smoke.sh) | Minimal gateway → PostgREST smoke (curl) |
| [packages/gateway/](../packages/gateway/) | Tenant resolution, proxy, JWT to upstream |
| [packages/cli/src/commands/push.ts](../packages/cli/src/commands/push.ts) | CLI push dispatch (v1 vs v2) |
| [bin/deploy-v2-shared.sh](../bin/deploy-v2-shared.sh) | Cluster bootstrap operator script |

---

## 10. Changelog of this document

| Date | Change |
|------|--------|
| 2026-05-04 | Review, CI, engine-v2 + validator hardening, `e2e-v2-shared-smoke.sh`; pooled push `runPooledPushPost` + route security tests; push timeout → 504 fix; opt-in CI + manual `workflow_dispatch` v2 gateway smoke. |
