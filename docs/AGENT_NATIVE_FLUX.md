# Agent-native Flux

Flux's strategic direction is **"the safety-gated, plan-first, agent-operable Postgres/runtime control plane."** AI coding agents (Cursor, Claude Code, Codex, Gemini CLI, Windsurf) are first-class operators: they provision, introspect, migrate, query, and back up real Postgres through a contract where every mutation is planned, every destructive action requires a restore-verified backup, credentials are scoped and ephemeral, and everything is audited.

This file records the agent-native milestones. Deeper strategy and roadmap live in the plan files under `.cursor/plans/`.

## Product checkpoint — Flux MCP v0 (2026-06-30)

**Flux MCP v0 now supports scoped-token, audited, safety-gated, controlled migration workflows.**

Shipped through Phase 5 (hosted smoke on `https://flux.vsl-base.com`, deploy `a1a5cc9`): scoped `flx_mcp_` tokens, dashboard issuance at `/settings/mcp-tokens`, `FLUX_MCP_TOKEN` auth, server-side capability/project enforcement, MCP-side capability guard, audit/intent identity via `keyPreview`/`keyType` only, and the full inspect → plan → ensure verified backup → preflight → apply loop (apply gated by `migration:apply` capability).

**Paused (not starting immediately):** streamable HTTP MCP transport, dashboard approval UI, org/team RBAC, destructive lifecycle MCP tools. Next prioritization is operator-driven.

## Milestones

### Pass 1: Read-only MCP introspection and destructive preflight

Status: complete.

The `@flux/mcp` package ships a thin, additive [Model Context Protocol](https://modelcontextprotocol.io) server (stdio) over the existing CLI control-plane API. It reuses the same `ApiClient` and auth/config as the `flux` CLI via `@flux/cli/api-client`. MCP prefers **`FLUX_MCP_TOKEN`** (scoped `flx_mcp_` tokens); **`FLUX_API_TOKEN`** remains a temporary legacy fallback with stderr warning. No new control-plane routes, no new data-plane paths, and no changes to v1/v2 runtime, gateway routing, provisioning, backup internals, or PostgREST.

Scope is deliberately **read + preflight only** — agents can observe and reason about a project, and ask whether a destructive action *would* be allowed, but cannot mutate anything. The non-mutation guarantee is enforced in code by the policy guard in `packages/mcp/src/policy.ts` (named `assertNonMutatingTools` as of Pass 2), which fails fast if a `write`/`destructive` tool is ever registered.

Tools:

- `flux.project.list` — projects (slug, hash, status, API URL, lifecycle).
- `flux.project.describe` — metadata + lifecycle state + `FLUX.md` brief.
- `flux.schema.inspect` — tables, columns, keys, RLS, grants, warnings.
- `flux.schema.counts` — per-table row counts + schema summary.
- `flux.migrations.list` — applied migration ledger.
- `flux.doctor` — project health checks.
- `flux.activity` — recent activity timeline.
- `flux.backup.list` — backups and validation/restore-verification state.
- `flux.destructive.preflight` — reuses `@flux/core/backup-trust` (`classifyNewestBackup` / `allowsDestructiveWithoutOverride`); returns the trust classification and remediation when blocked. No mutation.

Every tool returns the standard envelope `{ ok, summary, data, remediation? }`, never leaks secrets (tokens, JWT secrets, DB passwords, anon/service-role material), and emits exactly one redacted audit JSON line to stderr (`event: "flux_mcp_tool_call"`). Errors are mapped to stable codes (`invalid_input`, `not_authenticated`, `unauthorized`, `not_found`, `upstream_error`).

See `packages/mcp/README.md` for local run + Cursor/agent registration.

**Live validation:** Pass 1 was validated end-to-end against the control plane using read/preflight tools only — `flux.project.list`, `flux.project.describe`, `flux.schema.inspect`, `flux.backup.list`, and `flux.destructive.preflight` all returned successfully with one redacted audit line per call and no mutations.

**Read-output polish (post-validation):** based on the live run, schema-inspection now deduplicates composite foreign-key columns upstream in `@flux/core` (so CLI, dashboard, and MCP all benefit), and `flux.project.describe` surfaces non-failing advisories (`agent_context_missing` when no FLUX.md brief is synced; `plan_limit_exceeded` when active projects exceed the plan limit).

### Pass 2: Migration planning and bounded read-only DB query

Status: complete.

Pass 2 extends the read-only server so agents can **plan migrations** and run **bounded read-only SQL** without gaining any write capability. The safety thesis is unchanged: every tool remains non-mutating, enforced by `assertNonMutatingTools` (allows `read`/`preflight`/`plan`/`credential`; rejects `write`/`destructive`).

New tools:

- `flux.migration.plan` — plans local `.sql` migrations against the applied ledger using the shared `@flux/core` planning primitives (`loadLocalMigrations` + `planMigrations`), classifies destructive-shaped DDL via `@flux/core/sql-ddl-classify`, and returns a `planId` + stable `planHash` + apply/skip/conflicts/warnings. Plans only; never applies. Plans are held in memory so a future `flux.migration.apply` can require a prior `planId`.
- `flux.credentials.temporary` — issues a short-lived, **readonly**, project-scoped DB credential (v2_shared only). Access is always `ro`; pooled-admin and service-role secrets are never returned.
- `flux.query.readonly` — runs a single bounded read-only query (v2_shared only) using a temporary readonly credential over the same SSH tunnel as `flux db`. A conservative validator accepts only single-statement `SELECT`/`WITH`, rejects non-read/privileged keywords (INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/GRANT/REVOKE/TRUNCATE/COPY/CALL/DO/MERGE and SECURITY DEFINER), enforces a statement timeout, and wraps the query in a hard outer LIMIT. Write attempts are denied before any database access.

**Live validation:** smoke-tested end-to-end against the control plane — `flux.migration.plan` produced a stable plan (apply/skip/conflicts, no apply), `flux.credentials.temporary` issued a readonly v2 credential, `flux.query.readonly` ran `SELECT 1` and a bounded `SELECT … LIMIT` over the SSH tunnel, and a write attempt (`INSERT …`) was rejected in ~1 ms with `invalid_input` — before any credential issuance or DB connection. This confirms the plan's goal: agents can understand, plan, and safely read without mutation.

**Mutation remains deferred to Phase 4.** Phase 3B adds only protective backup mutation; there are still no write/apply/schema-mutation tools until Phase 4 lands.

### Phase 3A: Persistent audit/intents and control-plane rate limiting

Status: complete.

Phase 3A adds the **ledger before loaded gun** foundation: agent actions become recorded, policy-checked intents rather than untracked side effects — still with **no mutation/apply tools**.

**Persisted audit events (`mcp_audit_events`):**

- Every MCP tool call still emits one redacted JSON line to stderr (`event: "flux_mcp_tool_call"`).
- After each call, the MCP server also POSTs to `POST /api/cli/v1/audit` (CLI key auth; server-owned `user_id`).
- Payloads redact tokens, passwords, temp credentials, JWTs, OAuth material, Authorization headers, and connection strings with credentials.
- Read/plan/query/preflight tools: audit persistence failure is **non-fatal** (stderr warning).
- Future write/destructive tools (Phase 3B+): audit persistence failure is **fatal** before execution (policy enforced now).

**Persisted intents (`mcp_intents`):**

- `flux.migration.plan` → `intent_class: plan` with `planId` / `planHash`
- `flux.credentials.temporary` → `intent_class: credential`, `risk_level: sensitive`
- `flux.query.readonly` → `intent_class: read` with row cap / timeout metadata (no SQL secrets)
- `flux.destructive.preflight` → `intent_class: preflight` with backup-trust decision metadata

Routes: `POST /api/cli/v1/intents`, `GET /api/cli/v1/intents/:id`.

**Control-plane rate limiting:**

- Fixed-window in-memory limiter on `/api/cli/v1/*` (keyed by CLI key hash, fallback `anon`).
- Stable `429` + `Retry-After`; write/sensitive tiers fail closed if limiter storage is unavailable; read tier may fail open with a warning.
- `POST /api/cli/v1/audit` uses a separate high allowance so audit logging cannot starve itself.

**Still deferred to Phase 4 (pre-4):** streamable HTTP, dashboard approval UI, destructive lifecycle MCP tools.

### Phase 4: Controlled migration apply (`flux.migration.apply`)

Phase 4 adds the **first schema/data mutation MCP tool**, but only through a previously generated migration plan. It completes the safe control loop:

```text
inspect → plan → intent → ensure verified backup → preflight → apply
```

1. `flux.migration.plan`
2. `flux.backup.ensureVerified`
3. `flux.destructive.preflight`
4. `flux.migration.apply`

**Behavior:**

- Applies only files in the stored plan’s apply set, in order, via existing CLI `pushSql` / versioned migration metadata (no duplicated push logic).
- Re-reads local migration files before apply; refuses missing/stale plans with typed `data.staleReason` codes and gate `migration_apply_blocked_stale_plan` (standard fix: re-run `flux.migration.plan`; `plan_not_found` also covers MCP server restart).
- Creates a pending **write** intent before any migration push API call; requires persisted audit APIs.
- Requires restore-verified backup trust when `requireVerifiedBackup !== false` (default true). **No `skipBackupCheck`.**
- Destructive-shaped plans (from `flux.migration.plan` classification) require `allowDestructive: true` and still require restore-verified backup.
- Refuses plans with conflicts; stops on first push failure with partial-apply metadata (`partialApply`, `failureIndex`, `remainingFiles`, ledger-safe remediation).
- Partial failure never includes raw SQL from push errors in summary or audit metadata.
- Intent + audit finalized with safe metadata only (no SQL, secrets, paths, credentials, raw backup rows).

**Audit gates:** `migration_apply_allowed`, `migration_apply_blocked_no_backup`, `migration_apply_blocked_stale_plan`, `migration_apply_blocked_destructive_requires_allow`, `migration_apply_failed`.

**Still deferred beyond Phase 4:** arbitrary write SQL, destructive lifecycle MCP tools (nuke, factory reset, restore, db-reset, project delete), streamable HTTP, dashboard approval UI.

**Operator response to partial apply:** Inspect `failedFile`; treat `appliedFiles` as ledgered history (do not edit the ledger). Fix forward with a new migration or resolve the push error, then `flux.migration.plan` → `flux.migration.apply`.

### Phase 4B — apply hardening (in progress)

**Slice A (complete):** Partial-apply summaries, remediation, intent/audit safe metadata.

**Slice B (complete):** Typed stale-plan `staleReason` codes, per-reason remediation, safe refusal `data` (`expectedPlanHash`, `changedFiles`, etc.), intent/audit metadata for stale refusals.

**Slice C (complete):** Read-only intent visibility API (`GET /api/agent/intents`, session auth) with sanitization (`mcp-intent-sanitize.ts`, `listMcpIntentsForUser`). Optional operator CLI list via `GET /api/cli/v1/intents` + `ApiClient.listMcpIntents`. **No approval flow.** **No new MCP mutation tools.**

**Slice D (complete):** Read-only **Agent Activity** dashboard page at `/agent-activity` — lists sanitized MCP intents with filters, pagination, and expandable safe detail. Uses session auth + `GET /api/agent/intents` only (no CLI token in browser). **Approval UI remains deferred.** Merged audit timeline deferred to Slice D2.

**Still in Phase 4B:** merged audit timeline (Slice D2).

**Slice E (complete):** Dedicated smoke fixture discipline — `mcp-smoke-fixture` operator doc, slug gate + `--allow-non-fixture-project` override, `9999_mcp_noop_smoke_*.sql` migrations, optional metadata advisory. See `plans/mcp/fixture-project.md`.

**Intent list API (Slice C):** `GET /api/agent/intents` (dashboard session) returns sanitized intents for the signed-in user only. Query: `projectHash`, `tool`, `status`, `intentClass`, `riskLevel`, `limit` (default 50, max 200), `cursor`. Response: `{ intents: [...], nextCursor? }` — each row has safe `summary` (not raw `requestSummary`) and sanitized `metadata`. Operators may also use `GET /api/cli/v1/intents` (Bearer) or `ApiClient.listMcpIntents()`.

**Agent Activity page (Slice D):** `/agent-activity` — read-only dashboard UI over the intent list API. Filters sync to URL query params; “Load more” uses `nextCursor`. Expand a row for safe summary/metadata JSON. Link from the projects header (“Agent Activity”). No approval actions. Merged audit+intent timeline is deferred (D2).

**Smoke fixture (Slice E):** Phase 4+ live smoke must target a disposable fixture project (`mcp-smoke-fixture` suggested). Script refuses non-fixture slugs unless `--allow-non-fixture-project`. Migration files: `9999_mcp_noop_smoke_*.sql` (comment + `SELECT version();`). Setup: `plans/mcp/fixture-project.md`.

### Phase 3B: Protective backup verification (`flux.backup.ensureVerified`)

Status: complete.

Phase 3B adds the **first MCP side-effect tool**, but only a **protective mutation** — create and restore-verify a backup so future destructive or write operations can be gated safely. Schema/data mutation remains Phase 4.

**Tool:** `flux.backup.ensureVerified` (`intent_class: protective_mutation`, `risk_level: low`)

**Ledger before side effect:**

1. Persistence client must be available (audit + intent create + intent update).
2. **Pending intent** is created before any backup API call.
3. Policy gate runs after intent is recorded.
4. Reuses existing CLI client methods: `listProjectBackups`, `createProjectBackup`, `verifyProjectBackup`.
5. Intent is updated to terminal state; terminal audit is written after the operation.

**Early return:** when the latest backup is already restore-verified and satisfies optional `maxAgeHours`, returns `created: false`, `verified: true` without creating noise.

**Output sanitization:** no artifact paths, volume roots, offsite keys/buckets, signed URLs, credentials, or raw backup rows in MCP output or audit payloads.

**Agent control loop:**

```text
inspect → plan → intent → ensure verified backup → preflight
```

Routes added: `PATCH /api/cli/v1/intents/:id` (terminal intent updates).

### Phase 3C: Sanitized backup-facing MCP outputs

Status: complete.

Phase 3C ensures **`flux.backup.list`** and **`flux.backup.ensureVerified`** never return raw control-plane backup rows to agents. Sanitization happens in `@flux/mcp` (`src/tools/backup-sanitize.ts`); the underlying `/api/cli/v1/projects/:hash/backups` response shape is unchanged.

**Safe fields:** backup id, status, kind/format labels, timestamps, artifact/restore verification status (and derived booleans), per-row trust classification, size, platform backup compliance summary.

**Removed:** paths, volume roots, offsite storage metadata, checksums, signed URLs, credentials, and nested raw artifact fields. Audit redaction also catches path-like string values.

### Still deferred (post–MCP v0)

Arbitrary write SQL, streamable HTTP transport, dashboard approval UI, and destructive lifecycle MCP tools.

### Phase 5: Scoped MCP tokens (`flx_mcp_`) — closed

Status: **closed** (Slices A–G + hosted smoke 2026-06-30). Legacy `FLUX_API_TOKEN` for MCP: `supported_with_warning`; **90-day deprecation clock starts 2026-06-30** (~2026-09-28 hard gate without `FLUX_MCP_ALLOW_LEGACY_CLI_TOKEN=1`). Paused follow-ups: token rotate, Agent Activity token-name join, streamable HTTP, approval UI.

Scoped MCP tokens limit the Flux MCP server to explicit projects, capabilities, and expiry. They are distinct from broad CLI keys (`flx_live_`).

**Slice A (complete):** `flux_mcp_tokens` schema, `flx_mcp_` crypto, capability/expiry helpers.

**Slice B (complete):** `authenticateMcpToken`, route allowlist, capability/project enforcement on `/api/cli/v1/*`.

**Slice C (complete):** Session API routes — `POST/GET /api/agent/mcp-tokens`, `DELETE /api/agent/mcp-tokens/:id`.

**Slice D (complete):** Dashboard UI at `/settings/mcp-tokens` — list, create, revoke, one-time plaintext display. Cross-link from API Keys settings.

**Slice E (complete):** MCP server prefers `FLUX_MCP_TOKEN` → `FLUX_API_TOKEN` → `~/.flux/config.json`. Legacy sources emit stderr warning (not stdout). Invalid `FLUX_MCP_TOKEN` fails at startup. CLI `resolveFluxApiToken()` unchanged.

**Slice F (complete):** `flx_mcp_` secret detection and redaction across stderr audit, persisted audit/intent payloads, and dashboard sanitized views. MCP audit/intent rows record `keyPreview` / `keyType: "mcp"` without plaintext token or hash. MCP-side capability preflight denies tools missing required capabilities when using `FLUX_MCP_TOKEN` (legacy `FLUX_API_TOKEN` unchanged with warning).

**Slice G (complete):** Rollout docs (`packages/mcp/README.md`, env-vars), Cursor config examples (production + `pnpm start`), capability presets, dashboard copy for `FLUX_MCP_TOKEN`, and non-breaking legacy deprecation notice (`legacyCliTokenForMcp: supported_with_warning`).

**Hosted smoke (2026-06-30):** Deployed to `https://flux.vsl-base.com` (`a1a5cc9`). Scoped token (`project:read`, `schema:read`, `backup:read`, `migration:plan`) on project `habitat` (`59b73eb`). Allowed: `flux.project.list` (single-project scope), `flux.schema.inspect`, `flux.migration.plan`. Denied: `flux.migration.apply` (`capability_denied`, missing `migration:apply`). Audit/intent rows show `keyPreview` + `keyType: "mcp"` only; no plaintext token or hash in persisted payloads.

See `plans/mcp/phase-5-scoped-mcp-tokens.md` and `packages/mcp/README.md` for Cursor setup.
