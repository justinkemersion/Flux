# Flux Trajectory TODO (Internal)

Internal execution tracker for engineering and operations.  
Not intended for public docs or marketing consumption.

---

## How to use this file

- Prioritize by **risk to production correctness** first, then scalability, then DX.
- Keep one source of truth for active trajectory work here.
- Update this file after:
  - each incident
  - each production deploy that changes architecture/ops behavior
  - each completed backlog item

### Status legend

- `todo`
- `in_progress`
- `blocked`
- `done`

### Priority legend

- `P0` — safety / correctness / security blocker
- `P1` — high-value reliability and operability
- `P2` — scale and maintainability
- `P3` — ergonomics / polish

---

## Current snapshot

- Last updated: `2026-06-21`
- Maintainer: Flux platform engineering
- Current default deploy flow: `deploy-v2-shared -> deploy-gateway -> deploy-web`

---

## P0 — Production correctness & safety

### 1) Gateway startup smoke in deploy script
- **Priority:** P0
- **Status:** todo
- **Owner:** platform
- **Why:** prevents silent rollout with restart-looping gateway
- **Scope:** `bin/deploy-gateway.sh`
- **Acceptance criteria:**
  - script retries liveness for a bounded warmup window (e.g. 30–60s)
  - exits non-zero with actionable log guidance if still unhealthy
  - prints final healthy/unhealthy verdict explicitly

### 2) v2 shared probe reliability without implicit Node requirement
- **Priority:** P0
- **Status:** todo
- **Owner:** platform
- **Why:** current probe assumes `node` + global `fetch` in probe container
- **Scope:** `bin/deploy-v2-shared.sh`
- **Acceptance criteria:**
  - probe works even if gateway image changes runtime toolset
  - fallback path documented and deterministic
  - no false “healthy” due to missing probe binary

### 3) Collision/error surface in dashboard API response
- **Priority:** P0
- **Status:** todo
- **Owner:** dashboard
- **Why:** `TenantShortIdCollisionError` should produce explicit operator-friendly API message
- **Scope:** `apps/dashboard/app/api/projects/route.ts`
- **Acceptance criteria:**
  - collision error maps to deterministic HTTP code/message
  - includes remediation hint (“regenerate tenant UUID / retry create”)
  - covered by route-level test

### 3b) Rotate all development and remote secrets after infra stabilization
- **Priority:** P0
- **Status:** todo
- **Owner:** platform
- **Why:** current dev/remote secret reuse is intentional short-term risk and must be removed before steady-state use
- **Scope:** gateway `.env`, v2 shared `.env`, system DB credentials, JWT secret
- **Acceptance criteria:**
  - generate new strong secrets for DB and JWT material
  - update remote runtime + local templates with new values
  - verify gateway/PostgREST JWT parity and successful end-to-end request flow

---

## P1 — Reliability & operability

### 4) Deploy-all stage report artifact
- **Priority:** P1
- **Status:** todo
- **Owner:** platform
- **Why:** easier postmortem and CI integration
- **Scope:** `bin/deploy-all.sh`
- **Acceptance criteria:**
  - writes per-stage result summary to a timestamped file
  - includes exit codes + elapsed times
  - preserves fail-fast semantics by default

### 5) Unified cache-eviction contract tests
- **Priority:** P1
- **Status:** todo
- **Owner:** dashboard + gateway
- **Why:** avoid regressions that reintroduce zombie routing
- **Scope:** domain CRUD + project delete routes
- **Acceptance criteria:**
  - tests verify eviction call for create/delete/update + project delete
  - tests assert fail-open behavior on Redis exceptions

### 6) Health/readiness contract doc parity
- **Priority:** P1
- **Status:** in_progress
- **Owner:** platform docs
- **Why:** operators need one trusted runbook
- **Scope:** README + `docs/OPERATIONS.md`
- **Acceptance criteria:**
  - endpoint semantics (`/health` vs `/health/deep`) are consistent everywhere
  - all deploy scripts reference same contract

---

## P2 — Scale & maintainability

### 7) Engine-v2 SQL bootstrap extraction
- **Priority:** P2
- **Status:** todo
- **Owner:** engine-v2
- **Why:** current SQL strings are dense; extraction reduces regression risk
- **Scope:** `packages/engine-v2/src/index.ts`
- **Acceptance criteria:**
  - cluster bootstrap SQL and tenant bootstrap SQL live in focused modules
  - unit tests snapshot critical SQL fragments

### 8) Shared deploy config schema validation
- **Priority:** P2
- **Status:** todo
- **Owner:** platform
- **Why:** catch env/config drift before container cycle
- **Scope:** deploy scripts + optional small validator tool
- **Acceptance criteria:**
  - validates required vars, weak placeholders, and network assumptions
  - exits with grouped actionable errors

### 9) Runtime metric baselines for v2
- **Priority:** P2
- **Status:** todo
- **Owner:** SRE
- **Why:** capacity planning for shared clusters
- **Scope:** gateway + postgrest + pgbouncer + postgres
- **Acceptance criteria:**
  - baseline dashboard or log export for p95 latency, error rates, connections
  - threshold alerts drafted

---

## P3 — Developer ergonomics

### 10) `make test-priority` / `pnpm` alias for hierarchy checks
- **Priority:** P3
- **Status:** todo
- **Owner:** DX
- **Why:** one command for must-pass checks
- **Scope:** root scripts / Makefile
- **Acceptance criteria:**
  - runs gateway health contract (mock/local) + dashboard tests + lint subset
  - clear pass/fail output by stage

### 11) Internal architecture diagrams refresh cadence
- **Priority:** P3
- **Status:** todo
- **Owner:** platform docs
- **Why:** docs drift is expensive during incidents
- **Scope:** `README.md`, `docs/pages/architecture/flux-v2-architecture.md`
- **Acceptance criteria:**
  - update checklist added to PR template
  - each architecture-impact PR references affected diagrams/docs

---

## Maker Platform Roadmap

Active execution of `docs/MAKER-PLATFORM-ROADMAP.md`. Phases are executed one at a time with a full `pnpm check:architecture && typecheck && test` gate between each.

| Phase | Status | Description |
|-------|--------|-------------|
| P0 | `done` | v2_shared schema inspection foundation |
| P1 | `done` | DB Inspection CLI (`flux db inspect\|tables\|describe\|counts`) |
| P2 | `done` | Dashboard Schema Explorer |
| P3 | `done` | Minimal Dashboard Data Preview (owner/admin, LIMIT 50) |
| P4 | `todo` | Project Doctor (`flux doctor`) |
| P5 | `todo` | Backup Visibility UX polish |
| P6 | `todo` | Migration Plan/Diff Visibility |
| P7 | `todo` | Activity Timeline |
| P8 | `todo` | Project metadata foundation (description/brief) |
| P9 | `todo` | Active/Dormant Lifecycle |
| P10 | `todo` | Portfolio Dashboard |
| P11 | `todo` | FLUX.md Project Brief |
| P12 | `todo` | AI-assisted brief + summaries |

---

## Recently completed

- `done` — **Maker Platform Phase 3:** Minimal Data Preview — `buildPreviewRowsSql` (identifier-validated, server-enforced LIMIT 50, ORDER BY PK); `GET /api/projects/[slug]/tables/[table]/rows` (session-authed, validates table against inspection); Schema/Rows tab toggle in `ProjectSchemaExplorer`; copy row JSON; null display; labeled as project-owner inspection; 380 tests, 0 failures.
- `done` — **Maker Platform Phase 2:** Dashboard Schema Explorer — `GET /api/projects/[slug]/schema` (session-authed, v1+v2); `ProjectSchemaExplorer` client component (table list → detail, columns, PK/FK, RLS badges); replaces "Table browser" stub in Database tools modal; `@flux/core/schema-inspection-types` browser-safe subpath added to client allowlist; 380 tests, 0 failures.
- `done` — **Maker Platform Phase 1:** DB Inspection CLI — `flux db inspect|tables|describe|counts`; formatter in `lib/db-inspect-output.ts`; handlers in `commands/db-inspect.ts`; registered under `flux db` in `register-cli/db.ts`; v1+v2; `--exact` flag on counts; 380 tests, 0 failures.
- `done` — **Maker Platform Phase 0:** v2_shared schema inspection — `inspectTenantSchema` now accepts `mode` from options (defaults to `v1_dedicated` for backward compat); `createPooledTenantCatalogQueryFn` in `pooled-schema-inspection.ts` provides a read-only pooled query path via `FLUX_SHARED_POSTGRES_URL`; `POST schema-inspection` route now supports both v1 and v2 (was 501 for v2); 7 new unit tests in `inspect.test.ts`; 380 tests, 0 failures.
- `done` — Introduced ordered orchestrator deploy script (`bin/deploy-all.sh`)
- `done` — Added collision guard and ownership markers in engine-v2 provisioning
- `done` — Added v2 rollback deprovision path to prevent orphan schema/role
- `done` — Added shared gateway cache eviction utility and delete-path eviction
- `done` — Added dashboard test suite command and rollback-focused tests

