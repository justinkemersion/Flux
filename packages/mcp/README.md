# @flux/mcp

Flux MCP server — operate Flux projects from AI coding agents (Cursor, Claude Code, Codex, Gemini CLI, Windsurf, …) over the [Model Context Protocol](https://modelcontextprotocol.io).

This is **Pass 1**: read + preflight only.

## What this is

A thin, additive [MCP](https://modelcontextprotocol.io) server that exposes the existing Flux control-plane API (`/api/cli/v1/*`) to AI agents. It reuses the exact same `ApiClient` and auth/config resolution as the `flux` CLI — no new control-plane routes, no new data-plane paths, and no changes to v1/v2 runtime behavior, provisioning, the gateway, backups, or PostgREST.

It is the smallest safe proof that Flux can be driven by agents through MCP.

## Why Pass 1 is read / preflight only

Pass 1 deliberately ships **no** write, query, migration-apply, or destructive tools. Agents can observe and reason about a project, and they can ask whether a destructive action *would* be allowed — but they cannot mutate anything. This keeps the blast radius at zero while we validate the agent integration.

The read-only guarantee is enforced in code: `assertPass1Tools` (see `src/policy.ts`) fails fast if any tool with a `write` or `destructive` intent is ever registered.

## Tools (Pass 1)

- `flux.project.list` — list projects (slug, hash, status, API URL, lifecycle).
- `flux.project.describe` — metadata + lifecycle state + `FLUX.md` brief.
- `flux.schema.inspect` — tables, columns, keys, RLS, grants, warnings.
- `flux.schema.counts` — per-table row counts + schema summary.
- `flux.migrations.list` — applied migration ledger.
- `flux.doctor` — project health checks.
- `flux.activity` — recent activity timeline.
- `flux.backup.list` — backups and their validation/restore-verification state.
- `flux.destructive.preflight` — whether destructive actions are currently allowed (reuses `@flux/core/backup-trust`); returns the trust classification and remediation when blocked. **Performs no mutation.**

Every tool returns the standard envelope:

```json
{ "ok": true, "summary": "human readable", "data": { }, "remediation": "optional next step" }
```

Tools never return tokens, JWT secrets, database passwords, or anon/service-role keys, and exactly one redacted audit line is written to **stderr** per call (`event: "flux_mcp_tool_call"`).

## Authentication

The server uses the same credentials as the `flux` CLI, resolved in this order:

1. `FLUX_API_TOKEN` environment variable.
2. `~/.flux/config.json` (written by `flux login`).

Optionally set `FLUX_API_BASE` to point at a non-default control plane.

Create a token in the Flux Dashboard (Settings → API keys), or run `flux login`.

## Run it locally

From the monorepo:

```bash
# Dev (no build step):
pnpm --filter @flux/mcp start

# Or build the bundled bin and run it:
pnpm --filter @flux/mcp build
node packages/mcp/dist/index.cjs
```

The process speaks MCP over stdio; it will sit waiting for an MCP client. Logs go to stderr.

## Register in Cursor

Add an entry to your Cursor MCP config (`~/.cursor/mcp.json` for global, or `.cursor/mcp.json` in a project). After `pnpm --filter @flux/mcp build`:

```json
{
  "mcpServers": {
    "flux": {
      "command": "node",
      "args": ["/absolute/path/to/flux/packages/mcp/dist/index.cjs"],
      "env": {
        "FLUX_API_TOKEN": "flx_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx_xxxx"
      }
    }
  }
}
```

Prefer not to build? Run the TypeScript entry directly with `tsx`:

```json
{
  "mcpServers": {
    "flux": {
      "command": "pnpm",
      "args": ["--filter", "@flux/mcp", "start"],
      "env": { "FLUX_API_TOKEN": "flx_live_..." }
    }
  }
}
```

The same `command`/`args`/`env` shape works for other MCP-capable agents (Claude Code, Codex, Gemini CLI, Windsurf).

## Deferred to Pass 2+

Write tools, read-only SQL query, migration plan/apply, scoped MCP tokens, streamable HTTP transport, control-plane rate limiting, and the dashboard approval/audit console are intentionally **not** in Pass 1.
