# Agent-native Flux

Flux's strategic direction is **"the safety-gated, plan-first, agent-operable Postgres/runtime control plane."** AI coding agents (Cursor, Claude Code, Codex, Gemini CLI, Windsurf) are first-class operators: they provision, introspect, migrate, query, and back up real Postgres through a contract where every mutation is planned, every destructive action requires a restore-verified backup, credentials are scoped and ephemeral, and everything is audited.

This file records the agent-native milestones. Deeper strategy and roadmap live in the plan files under `.cursor/plans/`.

## Milestones

### Pass 1: Read-only MCP introspection and destructive preflight

Status: complete.

The `@flux/mcp` package ships a thin, additive [Model Context Protocol](https://modelcontextprotocol.io) server (stdio) over the existing CLI control-plane API. It reuses the same `ApiClient` and auth/config as the `flux` CLI (`FLUX_API_TOKEN` → `~/.flux/config.json`) via the new additive `@flux/cli/api-client` export subpath. No new control-plane routes, no new data-plane paths, and no changes to v1/v2 runtime, gateway routing, provisioning, backup internals, or PostgREST.

Scope is deliberately **read + preflight only** — agents can observe and reason about a project, and ask whether a destructive action *would* be allowed, but cannot mutate anything. The read-only guarantee is enforced in code by `assertPass1Tools` (`packages/mcp/src/policy.ts`), which fails fast if a `write`/`destructive` tool is ever registered.

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

### Deferred to Pass 2+

Write tools, read-only SQL query (via ephemeral `ro` credentials), migration plan/apply (plan-first with a `planId`), control-plane rate limiting, scoped `flx_mcp_` tokens, streamable HTTP transport, a persisted `mcp_audit_events` ledger, and the dashboard approval/audit console.
