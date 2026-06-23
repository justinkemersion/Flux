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

- Last updated: `2026-06-23`
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

## CLI versioning contract

`packages/cli` version is the canonical user-facing capability indicator.
Bump the **minor** version when a meaningful phase group ships; bump **patch** for fixes.

| Version | Phases | Capability tier |
|---------|--------|-----------------|
| `1.1.0` | 0–4 | DB inspection · schema/data explorer · project doctor |
| `1.2.0` | 5–7 | Backup visibility UX · migration plan/diff · activity timeline |
| `1.3.0` | 8–10 | Active/dormant lifecycle · portfolio dashboard · FLUX.md |
| `2.0.0` | 11–12 | AI summaries (Layer 3 milestone) |

**Rule:** `packages/cli/package.json` version, `CLI_VERSION` constant in `cli-handlers/cli-version.ts`, and the version printed in `flux doctor` output must stay in sync. Update all three atomically.

---

## Maker Platform Roadmap

Active execution of `docs/MAKER-PLATFORM-ROADMAP.md`. Phases are executed one at a time with a full `pnpm check:architecture && typecheck && test` gate between each.

| Phase | Status | Description |
|-------|--------|-------------|
| P0 | `done` | v2_shared schema inspection foundation |
| P1 | `done` | DB Inspection CLI (`flux db inspect\|tables\|describe\|counts`) |
| P2 | `done` | Dashboard Schema Explorer |
| P3 | `done` | Minimal Dashboard Data Preview (owner/admin, LIMIT 50) |
| P4 | `done` | Project Doctor (`flux doctor`) |
| P5 | `done` | Backup Visibility UX polish |
| P6 | `done` | Migration Plan/Diff Visibility |
| P7 | `done` | Activity Timeline |
| P8 | `done` | Project metadata foundation (description/brief) |
| P9 | `todo` | Active/Dormant Lifecycle |
| P10 | `todo` | Portfolio Dashboard |
| P11 | `todo` | FLUX.md Project Brief |
| P12 | `todo` | AI-assisted brief + summaries |

---

## Recently completed

- `done` — **Maker Platform Phase 8:** Project metadata foundation — `projects.description` + `projects.brief` columns; `@flux/core/project-metadata` validation; session + CLI GET/PATCH metadata routes; `flux project metadata`; dashboard `ProjectMetadataPanel`; fleet card subtitle shows description when set.
- `done` — **Maker Platform Phase 7:** Activity Timeline — `project_activity_events` system table + `@flux/core/project-activity` kinds/summaries/redaction; emitters on project create, migration apply, backup create/verify, temp DB credential; `flux activity` / `flux project activity`; dashboard `ProjectActivityPanel` on project mesh readout; session GET `/api/projects/[slug]/timeline` + CLI GET `/api/cli/v1/projects/[hash]/activity`.
- `done` — **Maker Platform Phase 6 (polish):** Migration plan footer + DDL classifier fixes (`IF NOT EXISTS`, policy names, RLS-only alters); `sql/migrations/` in default push discovery.
- `done` — **Maker Platform Phase 6:** Migration Plan/Diff — heuristic `@flux/core/sql-ddl-classify` (CREATE/ALTER/DROP, indexes, policies, RLS, DROP warnings); enriched `flux push --plan` with per-file DDL summaries; dashboard `ProjectMigrationsPanel` (applied ledger + CLI plan hint); session-auth GET `/api/projects/[slug]/migrations`.
- `done` — **Maker Platform Phase 5:** Backup Visibility UX — shared `formatBackupTrustSummary` / confidence-not-punishment copy in `@flux/core/backup-trust`; `ProjectBackupStatusCard` on project overview + inline badge on fleet cards; Database tools header summary; aligned delete/factory-reset gate copy; `flux backup list` status block + doctor backup lines; CLI `1.2.0`.
- `done` — **Maker Platform Phase 4:** Project Doctor — `runProjectDoctor` server-side orchestration (schema/DB, API probe, migration ledger, backup trust); `POST /api/cli/v1/projects/:hash/doctor` (CLI bearer) + `GET /api/projects/[slug]/doctor` (session); `flux doctor` CLI with PASS/WARN/FAIL output and non-zero exit on FAIL; `ProjectHealthCard` collapsible card in project mesh readout; 380 tests, 0 failures.
- `done` — **Maker Platform Phase 3:** Minimal Data Preview — `buildPreviewRowsSql` (identifier-validated, server-enforced LIMIT 50, ORDER BY PK); `GET /api/projects/[slug]/tables/[table]/rows` (session-authed, validates table against inspection); Schema/Rows tab toggle in `ProjectSchemaExplorer`; copy row JSON; null display; labeled as project-owner inspection; 380 tests, 0 failures.
- `done` — **Maker Platform Phase 2:** Dashboard Schema Explorer — `GET /api/projects/[slug]/schema` (session-authed, v1+v2); `ProjectSchemaExplorer` client component (table list → detail, columns, PK/FK, RLS badges); replaces "Table browser" stub in Database tools modal; `@flux/core/schema-inspection-types` browser-safe subpath added to client allowlist; 380 tests, 0 failures.
- `done` — **Maker Platform Phase 1:** DB Inspection CLI — `flux db inspect|tables|describe|counts`; formatter in `lib/db-inspect-output.ts`; handlers in `commands/db-inspect.ts`; registered under `flux db` in `register-cli/db.ts`; v1+v2; `--exact` flag on counts; 380 tests, 0 failures.
- `done` — **Maker Platform Phase 0:** v2_shared schema inspection — `inspectTenantSchema` now accepts `mode` from options (defaults to `v1_dedicated` for backward compat); `createPooledTenantCatalogQueryFn` in `pooled-schema-inspection.ts` provides a read-only pooled query path via `FLUX_SHARED_POSTGRES_URL`; `POST schema-inspection` route now supports both v1 and v2 (was 501 for v2); 7 new unit tests in `inspect.test.ts`; 380 tests, 0 failures.
- `done` — Introduced ordered orchestrator deploy script (`bin/deploy-all.sh`)
- `done` — Added collision guard and ownership markers in engine-v2 provisioning
- `done` — Added v2 rollback deprovision path to prevent orphan schema/role
- `done` — Added shared gateway cache eviction utility and delete-path eviction
- `done` — Added dashboard test suite command and rollback-focused tests

