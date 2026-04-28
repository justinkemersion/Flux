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

- Last updated: `2026-04-28`
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
- **Scope:** `README.md`, `docs/flux-v2-architecture.md`
- **Acceptance criteria:**
  - update checklist added to PR template
  - each architecture-impact PR references affected diagrams/docs

---

## Recently completed

- `done` — Introduced ordered orchestrator deploy script (`bin/deploy-all.sh`)
- `done` — Added collision guard and ownership markers in engine-v2 provisioning
- `done` — Added v2 rollback deprovision path to prevent orphan schema/role
- `done` — Added shared gateway cache eviction utility and delete-path eviction
- `done` — Added dashboard test suite command and rollback-focused tests

