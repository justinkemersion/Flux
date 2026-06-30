---
title: Flux MCP v0
description: Release notes for scoped-token, audited, safety-gated agent operations (Phase 5 closed 2026-06-30).
section: reference
---

# Flux MCP v0

**Ship date:** 2026-06-30 · **Hosted deploy:** `a1a5cc9` on `https://flux.vsl-base.com`

Flux MCP v0 is the first production-ready agent control plane for Flux: scoped tokens, persisted audit/intents, backup-gated migration apply, and defense-in-depth capability enforcement.

## Summary

> **Flux MCP v0 now supports scoped-token, audited, safety-gated, controlled migration workflows.**

Agents (Cursor, Claude Code, Codex, Windsurf, …) operate real Postgres projects through `@flux/mcp` over the existing `/api/cli/v1/*` control plane — no new data-plane paths.

## What's new

### Scoped MCP tokens (`flx_mcp_`)

- Dashboard issuance at [**Settings → MCP tokens**](/settings/mcp-tokens) (`/settings/mcp-tokens`).
- Per-token **project allowlist**, **capability allowlist**, and **expiry** (shorter defaults when `migration:apply` or `backup:ensure_verified` is included).
- Plaintext shown **once** at creation; storage is hash-only plus safe `keyPreview`.
- MCP server prefers **`FLUX_MCP_TOKEN`** → legacy `FLUX_API_TOKEN` / `~/.flux/config.json` (stderr warning only).

### Safety-gated mutation loop

```text
inspect → plan → intent → ensure verified backup → preflight → apply
```

- **`flux.migration.apply`** is the only schema write tool; it requires a prior plan, restore-verified backup trust, persisted audit/intent, and the `migration:apply` capability.
- Destructive lifecycle MCP tools (nuke, factory reset, project delete, …) remain **blocked**.

### Audit and identity

- Every tool call: redacted stderr audit line + `POST /api/cli/v1/audit`.
- Selected tools also record intents (`POST /api/cli/v1/intents`).
- MCP-authenticated rows store `keyPreview` and `keyType: "mcp"` — never plaintext token or hash.
- Operator visibility: [**Agent Activity**](/agent-activity) (session auth, sanitized intents).

## Operator setup

1. Open `/settings/mcp-tokens` and create a scoped token (start with a read/plan preset if you are exploring).
2. Copy the token once into your MCP client:

```json
{
  "mcpServers": {
    "flux": {
      "command": "node",
      "args": ["/path/to/flux/packages/mcp/dist/index.cjs"],
      "env": {
        "FLUX_MCP_TOKEN": "flx_mcp_...",
        "FLUX_API_BASE": "https://flux.vsl-base.com/api"
      }
    }
  }
}
```

3. Build if needed: `pnpm --filter @flux/mcp build`.

Deep setup, capability presets, and smoke discipline: [`packages/mcp/README.md`](../../../packages/mcp/README.md), [`docs/AGENT_NATIVE_FLUX.md`](../../AGENT_NATIVE_FLUX.md), [`plans/mcp/fixture-project.md`](../../../plans/mcp/fixture-project.md).

## Legacy MCP auth deprecation

| Status | Detail |
|--------|--------|
| **Now** | `FLUX_API_TOKEN` / `flx_live_` still works for MCP with stderr warning (`supported_with_warning`). |
| **Clock** | 90-day deprecation window starts **2026-06-30** (hosted smoke sign-off). |
| **~2026-09-28** | Plan: legacy MCP CLI keys require explicit opt-in (`FLUX_MCP_ALLOW_LEGACY_CLI_TOKEN=1`) before hard removal in a later phase. |
| **CLI unchanged** | `flux login` / `flx_live_` keys remain the normal CLI family. |

## Hosted validation (2026-06-30)

Scoped token on project `habitat` (`59b73eb`) with `project:read`, `schema:read`, `backup:read`, `migration:plan`:

| Tool | Result |
|------|--------|
| `flux.project.list` | Allowed — single-project scope |
| `flux.schema.inspect` | Allowed |
| `flux.migration.plan` | Allowed |
| `flux.migration.apply` | Denied — missing `migration:apply` |

Audit/intent rows showed `keyPreview` + `keyType: "mcp"` only; no token or hash leakage in persisted payloads.

## Post-release ops audit (2026-06-30)

`./bin/ops-audit.sh --remote --deep --smoke`:

| Result | Detail |
|--------|--------|
| **Core stack** | `flux-web`, gateway, v2 Postgres, tenant stacks — running |
| **Control plane** | System DB ready, backup scheduler + fleet monitor started |
| **Tenant edge** | 14 smoke probes — edge routing OK |
| **FAIL (1)** | `yeastcoast` — latest backup `restore_verification failed` (address before unattended destructive ops) |
| **WARN (15)** | v2 gateway 401 on unauthenticated probes (expected Pass 1 semantics); stale exited test containers; backup-scheduler errors in log tail (2); disk 82% |

Re-run: `./bin/ops-audit.sh --remote --deep --smoke` (optional targets: `bin/ops-audit-smoke.projects.example` → `bin/ops-audit-smoke.projects`).

## Paused follow-ups

Not starting immediately:

- Streamable HTTP MCP transport
- Dashboard approval UI for intents
- Token rotate endpoint
- Agent Activity token-name join

## See also

- [Environment variables — `FLUX_MCP_TOKEN`](/docs/reference/env-vars)
- [Production hardening — periodic audit](/docs/guides/production-hardening)
- [Phase 5 plan (closed)](../../../plans/mcp/phase-5-scoped-mcp-tokens.md)
