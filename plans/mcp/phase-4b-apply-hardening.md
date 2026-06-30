# Flux MCP Phase 4B — Migration Apply Hardening

**Status:** Complete — Slice E done (D2 merged audit timeline deferred)  
**Precedes:** Scoped `flx_mcp_` tokens, streamable HTTP, any new mutation tools  
**Builds on:** Phase 4 (`flux.migration.apply`), Phase 4 smoke safety (`--hash`, `--slug`, `--yes-apply-smoke-migration`)

---

## Executive summary

Phase 4 made Flux **AI-operable with bounded mutation**: agents can apply migrations only through a prior plan, with backup trust, persisted intents, and audit. Phase 4B **does not expand mutation surface**. It hardens and polishes the apply path and makes agent actions **visible to operators** in the dashboard.

Five additive workstreams:

1. **Partial-apply UX** — clearer MCP summaries and remediation when apply stops mid-plan.
2. **Stale-plan clarity** — distinct, actionable errors for every plan-drift failure mode.
3. **Intent visibility** — read-only dashboard/API access to persisted MCP intents.
4. **Agent Activity** — read-only dashboard page (and optional project panel) for MCP audit + intents.
5. **Smoke fixture discipline** — dedicated disposable project strategy; preserve explicit-target safety.

All changes remain **additive**. No new write/destructive MCP tools, no approval UI, no ledger edits, no runtime/gateway/provisioning changes.

---

## Non-goals

Phase 4B explicitly **does not** include:

- Destructive lifecycle MCP tools (nuke, factory reset, restore, db-reset, project delete)
- Arbitrary SQL write tools or raw `pushSql` exposure to agents
- Scoped `flx_mcp_` tokens (deferred — see [Deferred beyond Phase 4B](#deferred-beyond-phase-4b))
- Streamable HTTP transport for MCP (deferred — milestone reference only)
- Dashboard approval / deny / override UI for intents
- Manual migration ledger editing or “undo apply”
- Persisted plan store (in-memory `plan-store.ts` stays for v0; messaging improves instead)
- Changes to v1/v2 runtime, gateway routing, PostgREST, backup internals, or provisioning

---

## Current state (Phase 4 baseline)

| Area | Today |
|------|--------|
| Apply tool | `packages/mcp/src/tools/migration-apply.ts` — ordered `pushSql`, partial metadata on failure |
| Plan store | In-memory `packages/mcp/src/plan-store.ts` — lost on MCP server restart |
| Write orchestration | `packages/mcp/src/write-mutation.ts`, `packages/mcp/src/server.ts` |
| Intent API | `POST` + `GET :id` + `PATCH :id` — **no list** (`apps/dashboard/app/api/cli/v1/intents/`) |
| Audit API | `POST /api/cli/v1/audit` — **no list** for dashboard consumption |
| DB tables | `mcp_intents`, `mcp_audit_events` in system DB (`apps/dashboard/src/db/schema.ts`) |
| Secret scanning | `apps/dashboard/src/lib/mcp-secret-scan.ts`, `containsObviousSecret` on persist |
| Smoke script | `packages/mcp/scripts/phase4-smoke.ts` + `packages/mcp/src/scripts/phase4-smoke-lib.ts` |
| Partial failure | `failedFile`, `appliedFiles`, `appliedCount` in `data`; summary string is generic |

Known gap: **bloom-atelier** received one real smoke ledger row (`9999_mcp_smoke_*.sql`, harmless `SELECT version();`). Future smoke must target a **fixture project only**.

---

## Proposed file changes

### 1. Partial-apply summaries and remediation

| File | Change |
|------|--------|
| `packages/mcp/src/tools/migration-apply.ts` | Introduce structured partial-failure helper; enrich `summary` + `remediation` + `data` |
| `packages/mcp/src/write-mutation.ts` | Persist partial-apply safe metadata on intent terminal update |
| `packages/mcp/src/tools/migration-apply.test.ts` | Assert summary text, remediation steps, no SQL in output |
| `packages/mcp/README.md` | Document partial-apply envelope shape |
| `docs/AGENT_NATIVE_FLUX.md` | Phase 4B partial-apply subsection |

**Proposed `data` extensions (safe only):**

```typescript
{
  partialApply: true,
  appliedCount: number,
  appliedFiles: string[],
  failedFile: string,
  failedAtIndex: number,        // 0-based index in planned apply set
  totalPlanned: number,
  errorCode: "upstream_error" | "invalid_input",
  gate: "migration_apply_failed",
  planId, planHash, intentId,
  backupTrustTier?,
  destructiveShaped
}
```

**Summary template (example):**

> Partial apply: 2 of 4 migrations applied; failed on `0003_add_index.sql` (file 3 of 4). Earlier files are on the ledger — do not edit applied migrations.

**Remediation template:**

> Fix the failed migration or add a forward migration. Run `flux.migration.plan` again before retrying `flux.migration.apply`. Do not re-apply already-ledgered files manually.

---

### 2. Clearer stale-plan messaging

| File | Change |
|------|--------|
| `packages/mcp/src/tools/migration-apply.ts` | Refactor validation into typed stale reasons |
| `packages/mcp/src/write-mutation.ts` | Map stale reasons to distinct summaries/remediation |
| `packages/mcp/src/plan-store.ts` | (Optional) export plan age / `createdAt` in error metadata only |
| `packages/mcp/src/tools/migration-apply.test.ts` | One test per stale reason |
| `packages/mcp/README.md` | Stale-plan troubleshooting table |

**Stale reason enum (proposed):**

| Code | User-facing summary | Remediation |
|------|---------------------|-------------|
| `plan_not_found` | Plan not found or MCP server restarted. | Re-run `flux.migration.plan` (in-memory plan store does not survive restart). |
| `plan_hash_mismatch` | Submitted `planHash` does not match stored plan. | Re-run `flux.migration.plan`; use the new `planId` + `planHash`. |
| `project_hash_mismatch` | Plan belongs to a different project. | Re-plan against the correct `--hash`. |
| `local_file_checksum_drift` | Local file `X` changed since planning. | Re-run `flux.migration.plan` after restoring or committing intended SQL. |
| `local_file_missing` | Planned file `X` missing locally. | Restore the file or re-plan from current workspace. |
| `ledger_drift` | Applied ledger changed since planning (recomputed planHash differs). | Re-run `flux.migration.plan`. |
| `plan_has_conflicts` | Plan contains checksum conflicts. | Resolve conflicts (new migration, do not edit applied files); re-plan. |
| `plan_empty_apply` | Plan has nothing to apply. | Add migrations or skip apply. |

All stale failures use gate `migration_apply_blocked_stale_plan` (unchanged) but add `data.staleReason` for agents/UI.

---

### 3. Dashboard / audit visibility for MCP intents (read-only)

| File | Change |
|------|--------|
| `apps/dashboard/app/api/cli/v1/intents/route.ts` | Add `GET` list (paginated, filtered) — **session auth for dashboard**, existing Bearer for CLI if needed |
| `apps/dashboard/app/api/agent/intents/route.ts` | **New** — dashboard session route wrapping list (preferred over exposing CLI key to browser) |
| `apps/dashboard/src/lib/mcp-intents.ts` | `listMcpIntentsForUser`, sanitization, filters |
| `apps/dashboard/src/lib/mcp-intent-sanitize.ts` | **New** — strip secrets/paths from `requestSummary` + `metadata` for UI |
| `packages/cli/src/api-client/mcp-intents.ts` | Optional `listMcpIntents` for CLI/operators |
| `apps/dashboard/src/lib/mcp-intent-sanitize.test.ts` | **New** — redaction tests |

**List filters:** `projectHash`, `tool`, `status`, `riskLevel`, `intentClass`, `limit`, `cursor` (createdAt + id).

**Response shape (safe):**

```typescript
{
  intents: [{
    intentId, status, tool, intentClass, riskLevel,
    projectHash, planId?, planHash?,
    policyDecision, resultStatus?, errorCode?,
    createdAt, updatedAt,
    metadata: { appliedCount?, appliedFiles?, failedFile?, destructiveShaped?, ... }  // sanitized
  }],
  nextCursor?
}
```

**Never return:** raw SQL, tokens, credentials, connection strings, signed URLs, backup paths, full `requestSummary` blobs without sanitization.

---

### 4. Read-only Agent Activity page

| File | Change |
|------|--------|
| `apps/dashboard/app/api/agent/activity/route.ts` | **New** — merged audit + intent timeline (session auth) |
| `apps/dashboard/src/lib/mcp-activity.ts` | **New** — query `mcp_audit_events` + join/light link to intents |
| `apps/dashboard/app/(dashboard)/agent-activity/page.tsx` | **New** — global Agent Activity page |
| `apps/dashboard/src/components/agent-activity/` | **New** — table, filters, detail drawer |
| `apps/dashboard/app/(dashboard)/projects/[slug]/page.tsx` or panel component | Optional **project-scoped** activity strip/tab |
| Dashboard nav layout | Link “Agent Activity” in sidebar/settings area |
| `apps/dashboard/AGENTS.md` | Document page + redaction rules |

**UI columns:** time, tool, intent class, status/result, risk, project (slug/hash link), gate, duration, safe metadata summary.

**Filters:** project, tool, status, risk level, date range (optional v0: project + tool + status).

**Detail drawer:** sanitized request summary keys only (hash, planId, planHash, migrationsPath as `[redacted]` if path-like), intent metadata, error code, gate — **no expand-to-show-SQL**.

Reuse patterns from `project-activity` and existing dashboard table components where possible.

---

### 5. Dedicated smoke fixture project

| File | Change |
|------|--------|
| `plans/mcp/fixture-project.md` | **New** — operator doc: create `flux-mcp-fixture` project, label in dashboard |
| `packages/mcp/scripts/phase4-smoke.ts` | Read optional `--fixture` flag that loads hash/slug from a checked-in **example** env file (not secrets) |
| `packages/mcp/src/scripts/phase4-smoke-lib.ts` | Export `FIXTURE_PROJECT_DOC`; optional validation that slug matches `mcp-fixture` naming convention |
| `docs/AGENT_NATIVE_FLUX.md` | Fixture project setup instructions |
| `packages/mcp/README.md` | Replace bloom-atelier references with fixture project |

**Fixture strategy:**

- Operator creates a disposable project (e.g. slug `flux-mcp-fixture`, v2_shared preferred).
- Document hash in `plans/mcp/fixture-project.md` (or local-only `.env.fixture.example` — **not committed with real hash** if rotated).
- Smoke migration remains: comment + `SELECT version();` via `buildSmokeMigrationSql`.
- **Required flags preserved:** `--hash`, `--slug`, `--yes-apply-smoke-migration`.
- Optional `--warn-if-not-fixture` when slug does not match `/^flux-mcp-/i` (warn + require explicit ack anyway).

**No-op migration generator:** already in `phase4-smoke-lib.ts`; extract to shared `packages/mcp/src/scripts/smoke-migration.ts` if dashboard docs reference it.

---

## Implementation checklist

Recommended slice order (one focused commit per slice when possible):

### Slice A — Partial apply polish (MCP-only)

- [x] Add `partialApply` summary/remediation builder in `migration-apply.ts`
- [x] Add `failureIndex`, `remainingFiles`, `partialApply` to failure `data`
- [x] Ensure intent terminal metadata includes partial fields (no SQL)
- [x] Persist partial-apply safe metadata on audit events
- [x] Unit tests for 0/N, k/N partial failures
- [x] Update MCP README + AGENT_NATIVE_FLUX
- [x] Run: `pnpm --filter @flux/mcp test`, `pnpm typecheck`

### Slice B — Stale-plan reason codes (MCP-only)

- [x] Introduce `MigrationApplyStaleReason` enum + mapper
- [x] Replace generic messages in `validateStoredPlanForApply` / `verifyPlanStillCurrent`
- [x] Include `staleReason` in `data`; keep gate `migration_apply_blocked_stale_plan`
- [x] One unit test per stale reason
- [x] Stale-plan troubleshooting table in README
- [x] Run: `pnpm --filter @flux/mcp test`, `pnpm typecheck`

### Slice C — Intent list API + sanitization (dashboard + optional CLI client)

- [x] `listMcpIntentsForUser` in `mcp-intents.ts` with filters + pagination
- [x] `mcp-intent-sanitize.ts` + tests (mirror `backup-sanitize` discipline)
- [x] Dashboard session route `GET /api/agent/intents`
- [x] `GET /api/cli/v1/intents` for operators (Bearer auth)
- [x] Route tests in `mcp-agent-intents-routes.test.ts`
- [x] Run: dashboard tests, `pnpm typecheck`, `pnpm check:architecture`

### Slice D — Agent Activity page (dashboard read-only UI)

- [x] Global page at `/agent-activity` with filters
- [x] Uses `GET /api/agent/intents` (sanitized intents only)
- [x] Pagination via `nextCursor` / Load more
- [x] Empty, loading, and error states
- [x] Expandable detail with safe summary/metadata only
- [x] Nav link from projects fleet bar
- [x] Unit tests for query building and display safety
- [ ] `mcp-activity.ts` merged audit timeline — **deferred to D2**
- [ ] `GET /api/agent/activity` — **deferred to D2**
- [ ] Optional project panel widget — **deferred**
- [x] Run: dashboard tests, `pnpm typecheck`, `pnpm check:architecture`

### Slice E — Smoke fixture discipline

- [x] Add `plans/mcp/fixture-project.md` operator setup
- [x] Slug convention gate + `--allow-non-fixture-project` override in smoke lib
- [x] Optional project metadata advisory via `getProjectMetadata`
- [x] `9999_mcp_noop_smoke_*.sql` migration naming + `smoke-migration.ts` helper
- [x] Update README smoke examples (fixture slug `mcp-smoke-fixture`)
- [x] Document bloom-atelier smoke row as historical; fixture for future runs
- [x] Run: `pnpm --filter @flux/mcp test`

---

## Acceptance criteria

### Partial apply

- [ ] When file k+1 fails after k successes, MCP returns `ok: false` with human-readable summary naming **count, failed file, and position**
- [ ] `data.appliedFiles` lists only successful files; `data.failedFile` set; `data.partialApply === true`
- [ ] Remediation mentions re-plan and warns that earlier files are ledgered
- [ ] No SQL, paths, secrets, or push error bodies with raw SQL in MCP output or intent metadata
- [ ] Intent terminal status is `failed`; audit gate is `migration_apply_failed`

### Stale plan

- [x] Each stale failure mode has a distinct `data.staleReason` code
- [x] Every stale remediation explicitly says to re-run `flux.migration.plan`
- [x] `plan_not_found` message mentions MCP server restart
- [x] Checksum drift names the affected filename when known

### Intent visibility

- [x] Operator can list intents for their account with filters
- [x] API responses pass secret scan / sanitization tests
- [x] No approval actions exposed

### Agent Activity

- [x] Dashboard page loads without CLI token in browser
- [x] Filters work for project, tool, status, intent class, risk level
- [x] Detail view shows safe metadata only
- [ ] Merged audit + intent timeline — deferred (Slice D2)

### Smoke fixture

- [x] Smoke script cannot run apply without `--hash`, `--slug`, `--yes-apply-smoke-migration`
- [x] Non-fixture slug refuses without `--allow-non-fixture-project`
- [x] Documentation describes fixture project setup (`plans/mcp/fixture-project.md`)
- [x] Generated migration is `9999_mcp_noop_smoke_*.sql` — comment + `SELECT version();` only

---

## Test plan

| Layer | Tests |
|-------|--------|
| MCP unit | Partial apply summary/remediation; each `staleReason`; no SQL in envelopes |
| MCP integration | `invokeFluxMcpTool` partial failure + intent metadata |
| Dashboard lib | `mcp-intent-sanitize`, `listMcpIntentsForUser`, `mcp-activity` queries |
| Dashboard routes | GET list auth, pagination, filter params, 401 without session |
| Redaction | JWT, `flx_live_`, postgres URLs, `/srv/`, SQL keywords in metadata |
| Architecture | `pnpm check:architecture` — no `@flux/core` barrel violations in new client components |

**Regression:** Full `pnpm test` + `pnpm typecheck` after each slice.

---

## Live smoke plan

Use **fixture project only** (not bloom-atelier or production apps):

```bash
# 1. Operator setup (once) — see plans/mcp/fixture-project.md
# 2. Full Phase 4 smoke
pnpm --filter @flux/mcp exec tsx scripts/phase4-smoke.ts \
  --hash <fixture-hash> \
  --slug flux-mcp-fixture \
  --yes-apply-smoke-migration
```

**Verify after Phase 4B slices A–B:**

1. Partial apply — inject a failing second migration in a temp workspace (unit/smoke hybrid); confirm summary + `partialApply` metadata.
2. Stale plan — modify local file post-plan; confirm `staleReason: local_file_checksum_drift`.
3. Restart refusal — clear plan store or use wrong `planId`; confirm `plan_not_found`.

**Verify after slices C–D:**

4. Dashboard Agent Activity shows the smoke run (plan, ensureVerified, apply intents/audit).
5. No secrets/paths/SQL visible in UI or network responses (browser devtools check).

---

## Deferred beyond Phase 4B

| Milestone | Notes |
|-----------|--------|
| **Scoped `flx_mcp_` tokens** | Next product identity checkpoint after apply hardening + visibility; limit blast radius per project/tool |
| **Streamable HTTP MCP transport** | Alternative to stdio for hosted agents; no change to tool semantics |
| **Persisted plan store** | Survive MCP restart; optional Redis/control-plane backing |
| **Approval UI** | Human-in-the-loop for destructive-shaped apply |
| **New mutation tools** | Any write beyond `flux.migration.apply` |
| **Destructive lifecycle MCP** | nuke, factory reset, restore, db-reset, project delete |

---

## Suggested first implementation prompt

Use this when starting Slice A:

> **Flux MCP Phase 4B — Slice A: Partial apply summaries**
>
> Read `plans/mcp/phase-4b-apply-hardening.md` (Slice A only).
>
> Improve `flux.migration.apply` partial-failure UX in `@flux/mcp`:
> - When apply stops after some files succeed, return a clear `summary`, structured `remediation`, and safe `data` (`partialApply`, `failedAtIndex`, `totalPlanned`, existing applied/failed fields).
> - Update intent terminal metadata in `write-mutation.ts` accordingly.
> - No raw SQL in any output. No new tools. No dashboard changes in this slice.
>
> Tests: extend `migration-apply.test.ts` for k-of-N failure summaries.
> Run: `pnpm --filter @flux/mcp test`, `pnpm typecheck`.
>
> Commit: `feat(mcp): improve partial migration apply summaries`

---

## References

- Phase 4 tool: `packages/mcp/src/tools/migration-apply.ts`
- Smoke safety: `packages/mcp/src/scripts/phase4-smoke-lib.ts`
- Intent schema: `apps/dashboard/src/db/schema.ts` (`mcpIntents`, `mcpAuditEvents`)
- Agent-native overview: `docs/AGENT_NATIVE_FLUX.md`
- MCP README: `packages/mcp/README.md`
