# Agent-native Flux

Flux's strategic direction is **"the safety-gated, plan-first, agent-operable Postgres/runtime control plane."** AI coding agents (Cursor, Claude Code, Codex, Gemini CLI, Windsurf) are first-class operators: they provision, introspect, migrate, query, and back up real Postgres through a contract where every mutation is planned, every destructive action requires a restore-verified backup, credentials are scoped and ephemeral, and everything is audited.

This file records the agent-native milestones. Deeper strategy and roadmap live in the plan files under `.cursor/plans/`.

## Milestones

### Pass 1: Read-only MCP introspection and destructive preflight

Status: complete.

The `@flux/mcp` package ships a thin, additive [Model Context Protocol](https://modelcontextprotocol.io) server (stdio) over the existing CLI control-plane API. It reuses the same `ApiClient` and auth/config as the `flux` CLI (`FLUX_API_TOKEN` → `~/.flux/config.json`) via the new additive `@flux/cli/api-client` export subpath. No new control-plane routes, no new data-plane paths, and no changes to v1/v2 runtime, gateway routing, provisioning, backup internals, or PostgREST.

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

**Mutation remains deferred to Pass 3.** There are still no write/apply tools.

### Deferred to Pass 3+

Durable mutation (`flux.migration.apply`), backup creation/verification tools, scoped `flx_mcp_` tokens, streamable HTTP transport, control-plane rate limiting, a persisted `mcp_audit_events` ledger, and the dashboard approval/audit console.
