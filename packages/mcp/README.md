# @flux/mcp

Flux MCP server — operate Flux projects from AI coding agents (Cursor, Claude Code, Codex, Gemini CLI, Windsurf, …) over the [Model Context Protocol](https://modelcontextprotocol.io).

This is **Phase 3B**: everything in Phase 3A **plus** one **protective mutation** tool (`flux.backup.ensureVerified`). Schema/data mutation (`flux.migration.apply`, etc.) remains **deferred to Phase 4**.

## What this is

A thin, additive [MCP](https://modelcontextprotocol.io) server that exposes the existing Flux control-plane API (`/api/cli/v1/*`) to AI agents. It reuses the exact same `ApiClient`, auth/config, migration-planning primitives, and DB-tunnel helpers as the `flux` CLI — no new backup routes, no new data-plane paths, and no changes to v1/v2 runtime behavior, provisioning, the gateway, backup internals, or PostgREST.

## Policy (Phase 3B)

Registered intents:

| Intent | Phase 3B |
|--------|----------|
| `read`, `preflight`, `plan`, `credential` | Allowed (non-mutating) |
| `protective_mutation` | Allowed **only** for `flux.backup.ensureVerified` |
| `write`, `destructive` | **Blocked** at registration (Phase 4) |

`assertRegisteredToolsPolicy` (see `src/policy.ts`) enforces the allowlist. Protective tools require persisted audit/intent APIs before any backup side effect:

1. Check persistence client exists (`recordMcpAuditEvent`, `createMcpIntent`, `updateMcpIntent`).
2. Create a **pending** intent (`POST /api/cli/v1/intents`).
3. `assertProtectiveMutationPolicy({ auditAvailable: true, intentRecorded: true })`.
4. Run backup ensure (existing CLI backup API client methods).
5. Update intent terminal state (`PATCH /api/cli/v1/intents/:id`).
6. Finalize terminal audit (`POST /api/cli/v1/audit`).

If intent creation fails, **no backup API calls** are made. If intent finalization fails after a successful backup, the tool returns `ok: false` with backup metadata and remediation (agents must not treat that as a clean success).

## Phase 3A — ledger before loaded gun

Every tool call:

1. Emits one redacted stderr audit line.
2. POSTs a redacted row to `POST /api/cli/v1/audit`.
3. For selected tools, also records an intent (`POST /api/cli/v1/intents` or pre/post lifecycle for protective mutation).

Audit persistence failure is **non-fatal** for read/plan/preflight/credential tools. **Fatal** for protective mutation (and future write/destructive tools).

## Tools

### Pass 1 — read / preflight

- `flux.project.list` — list projects (slug, hash, status, API URL, lifecycle).
- `flux.project.describe` — metadata + lifecycle state + `FLUX.md` brief (plus non-failing advisories).
- `flux.schema.inspect` — tables, columns, keys, RLS, grants, warnings.
- `flux.schema.counts` — per-table row counts + schema summary.
- `flux.migrations.list` — applied migration ledger.
- `flux.doctor` — project health checks.
- `flux.activity` — recent activity timeline.
- `flux.backup.list` — backups and their validation/restore-verification state.
- `flux.destructive.preflight` — whether destructive actions are currently allowed (reuses `@flux/core/backup-trust`). **No mutation.**

### Pass 2 — plan / credential / read-only query

- `flux.migration.plan` — plan local `.sql` migrations (never applies).
- `flux.credentials.temporary` — short-lived **readonly** v2 credential.
- `flux.query.readonly` — bounded read-only SQL over the SSH tunnel.

### Phase 3B — protective mutation

- `flux.backup.ensureVerified` — ensure a **restore-verified** backup exists. Reuses an existing restore-verified backup when fresh enough (`verifyLatestIfFresh`, optional `maxAgeHours`); otherwise creates and verifies via existing `createProjectBackup` / `verifyProjectBackup` client methods. **Never accepts `skipBackupCheck`.** Output excludes artifact paths, volume roots, offsite keys/buckets, signed URLs, and credentials.

**Suggested agent flow:**

```text
inspect → plan → intent → ensure verified backup → preflight
```

### `flux.backup.ensureVerified` input schema

```json
{
  "hash": "abc1234",
  "slug": "optional-label",
  "reason": "optional audit note",
  "verifyLatestIfFresh": true,
  "maxAgeHours": 24,
  "wait": true
}
```

Required: `hash`. Defaults: `verifyLatestIfFresh: true`, `wait: true`.

Every tool returns:

```json
{ "ok": true, "summary": "human readable", "data": { }, "remediation": "optional next step" }
```

## Authentication

Same as the `flux` CLI: `FLUX_API_TOKEN` or `~/.flux/config.json` from `flux login`. Optional `FLUX_API_BASE` for non-default control planes.

## Run it locally

```bash
pnpm --filter @flux/mcp start
pnpm --filter @flux/mcp build
node packages/mcp/dist/index.cjs
```

## Register in Cursor

```json
{
  "mcpServers": {
    "flux": {
      "command": "node",
      "args": ["/absolute/path/to/flux/packages/mcp/dist/index.cjs"],
      "env": { "FLUX_API_TOKEN": "flx_live_..." }
    }
  }
}
```

## Deferred to Phase 4

`flux.migration.apply`, schema/data mutation tools, destructive lifecycle MCP tools (nuke, factory reset, restore, db-reset, project delete), scoped `flx_mcp_` tokens, streamable HTTP, dashboard approval UI.
