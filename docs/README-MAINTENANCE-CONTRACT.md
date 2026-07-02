# README and documentation maintenance contract

**Status:** canonical policy for the Flux monorepo  
**Orientation doc:** [`README.md`](../README.md)

This contract keeps Flux documentation aligned with the platform as it evolves. README is the **canonical orientation document** — the first place a developer, operator, app builder, or AI coding agent should land.

---

## Policy

1. **README is canonical orientation** — product identity, capabilities, architecture summary, workflows, CLI tree, MCP section, deploy basics, and documentation map live in [`README.md`](../README.md).

2. **Same-commit updates** — Any PR or commit that changes **platform surface area** must update README and/or other canonical docs in the **same commit**, unless the commit is explicitly mechanical/refactor with **no behavior change** (state that in the commit message).

3. **No aspirational shipping** — Do not document features as shipped when they are planned, partial, or deferred. Use honest labels: `stable`, `beta`, `experimental`, `internal`, `operator-only`, `trajectory`, `deferred`.

4. **Preserve operator knowledge** — When removing detail from README, confirm equivalent content exists in `docs/pages/*`, `docs/guides/*`, or an operator doc (e.g. [`OPERATOR-DEPLOY-TRIAGE.md`](OPERATOR-DEPLOY-TRIAGE.md)). Do not leave v2 behavior, private DB access, destructive gates, or deploy triage only in git history.

5. **Destructive / security-sensitive changes** — Must include backup/safety documentation in README and/or relevant guides when behavior changes.

---

## What counts as platform surface area

Update docs when you change any of:

| Category | Examples |
|----------|----------|
| **CLI** | New/renamed/removed commands, flags, backup-gate behavior |
| **Packages** | New workspace package, major export or responsibility shift |
| **Runtime services** | Gateway, PostgREST pool, v2 shared cluster, Traefik wiring |
| **MCP / tooling** | Tools, capabilities, presets, auth, transport, contract version |
| **Dashboard** | User-visible features, API routes, auth, MCP token UI |
| **Gateway / routing** | Host rules, JWT handshake, rate limits, lifecycle gates |
| **DB access** | Tunnel, temp roles, v1/v2 access plans |
| **Backups / restore** | Trust tiers, destructive gates, scheduler, offsite |
| **Deployment** | `bin/deploy*.sh`, env sync, health probes, triage |
| **Environment variables** | New required/optional vars with operator or app impact |
| **Security posture** | Auth model, threat boundaries, pass completion |
| **Public docs paths** | `docs/pages/*` IA, rendered `/docs/*` routes |
| **Product identity** | How Flux describes itself (BaaS vs control plane, v1/v2 naming) |

---

## Cross-document obligations

| If the change affects… | Update… |
|------------------------|---------|
| **App developers** (v2_shared footguns) | [`AGENTS.md`](../AGENTS.md) + relevant [`docs/pages/guides/*`](pages/guides/) |
| **Operators** (deploy, triage, mode-split) | [`README.md`](../README.md) + [`docs/OPERATOR-*.md`](.) or [`docs/pages/guides/production-hardening.md`](pages/guides/production-hardening.md) |
| **MCP / AI agents** | README MCP section + [`packages/mcp/README.md`](../packages/mcp/README.md) + [`docs/pages/guides/mcp.md`](pages/guides/mcp.md) + [`docs/AGENT_NATIVE_FLUX.md`](AGENT_NATIVE_FLUX.md) if strategy shifts |
| **Roadmap / priority** | [`docs/TRAJECTORY-TODO.md`](TRAJECTORY-TODO.md) (`Last updated` line) |
| **Dashboard UI scope** | [`docs/UI-SCOPE-CONTRACT.md`](UI-SCOPE-CONTRACT.md) when admission rules change |
| **Security passes** | [`plans/security/CURRENT.md`](../plans/security/CURRENT.md) |

---

## Agent and contributor checklist

Before marking work **complete**, verify:

- [ ] Does this change platform surface area (see table above)?
- [ ] If yes: is [`README.md`](../README.md) updated, or commit message explains why not?
- [ ] If app-facing: is [`AGENTS.md`](../AGENTS.md) updated?
- [ ] If operator-facing: are deploy/triage/security docs updated?
- [ ] If MCP-related: README MCP section + MCP package/page docs updated?
- [ ] Are experimental/beta/deferred features labeled honestly (not described as stable)?
- [ ] Are new CLI commands reflected in README CLI tree (and [`docs/pages/reference/cli.md`](pages/reference/cli.md) when user-facing)?
- [ ] Do README links resolve to existing files?
- [ ] If roadmap impact: is [`TRAJECTORY-TODO.md`](TRAJECTORY-TODO.md) updated?
- [ ] If destructive/security behavior changed: backup gate docs updated?
- [ ] Ran `pnpm typecheck` and relevant tests after substantive code+doc changes?
- [ ] Updated README `Last reviewed:` date when README content changed materially?

---

## Deploy discipline (warning only)

[`bin/deploy-all.sh`](../bin/deploy-all.sh) may **warn** (not block) when [`README.md`](../README.md) or [`TRAJECTORY-TODO.md`](TRAJECTORY-TODO.md) `Last updated` / `Last reviewed` lines are older than `FLUX_DOCS_STALE_DAYS` (default 14). This is a reminder, not a hard gate.

---

## Related agent rules

- [`AGENTS.md`](../AGENTS.md) — documentation freshness rule for external app repos
- [`.cursor/rules/documentation-freshness.mdc`](../.cursor/rules/documentation-freshness.mdc) — Cursor agent rule
- [`.cursorrules`](../.cursorrules) — project context + doc pointer
