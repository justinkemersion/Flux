# docs/_review/technical-truth.md

# Technical truth review pass

This pass verifies every factual claim in a docs change against its source: the codebase, the running CLI, the gateway, and the control plane.

It is the most expensive pass in the system. Reserve it for changes that touch behavior, flags, env vars, hostnames, role names, schema names, or trust boundaries — and for the periodic full-corpus sweep.

It runs after the [IA](ia-review.md) and [cognitive-load](cognitive-load.md) passes.

## Purpose

Catch:

- CLI flags or subcommands that the docs claim exist but the binary does not implement
- env var names that diverge from what the dashboard, CLI, or gateway actually reads
- hostname patterns, schema name formats, role names, or default values that drift from code
- trust and isolation claims that the code does not actually enforce
- error codes or error strings cited verbatim that no code path emits
- examples that describe behavior the system does not produce

## Trigger

Run this pass when a change does any of the following:

- adds, renames, or repurposes a CLI flag, subcommand, env var, or HTTP endpoint
- adds or modifies a "How it works" section in any concept, architecture, security, or threat-model page
- adds or modifies a hostname pattern, role name, schema name, or default value
- changes a trust claim ("only the gateway issues …", "PostgREST is not publicly reachable …")
- introduces a new code or shell example
- runs as part of the **quarterly full-corpus pass** over `docs/pages/`

## Inputs

Read, in this order:

1. The changed pages.
2. [`_contract/terminology.md`](../_contract/terminology.md) — to confirm vocabulary still matches code.
3. The source code that owns each claim. Likely directories, depending on subject:
   - CLI surface: `apps/cli/`, `packages/cli/`, or wherever `flux` is built in this repo.
   - Dashboard / control plane: `apps/dashboard/`.
   - Gateway: the gateway package directory (resolve from current monorepo layout — do not assume).
   - Tenant provisioning, schema generation, role naming: the package that owns provisioning.
4. The running CLI: `flux --help`, `flux <subcommand> --help`, and `flux <subcommand> --help` for every subcommand the page references.
5. The root [`AGENTS.md`](../../AGENTS.md) and [`apps/dashboard/AGENTS.md`](../../apps/dashboard/AGENTS.md) — they capture non-obvious truths about the current system.
6. Optional but high-value: a scratch project (`flux create`, `flux push`, one HTTP request) to verify end-to-end claims actually hold today.

## Method

Apply each step in order. Each finding gets an ID `TRUTH-<n>` and a severity. Each finding **must cite a source-of-truth location** (file:line, command output, or running observation).

1. **Extract every factual claim from the page.** Make a flat list. A claim is anything the reader could disprove by running the system: a flag name, a default value, a hostname shape, an error code, a schema name format, a role name, a step ordering, an isolation guarantee.
2. **For each claim, find the source of truth.**
   - CLI flags / subcommands → the CLI source and `--help` output. Both must agree; if they disagree, the binary the user runs wins for the doc, and the source mismatch becomes a follow-up finding for engineering.
   - Env vars → the loader code on each side that reads the variable (dashboard, CLI dotenv, gateway, PostgREST container env). Confirm the variable name is read where the page says it is.
   - Hostname patterns → the gateway parser tests and the URL builder used by the dashboard / CLI. Both flattened and any legacy form mentioned must trace to live parsing.
   - Schema name format → the schema generator. Confirm the shortid length and suffix exactly. The current canonical form is `t_<12-hex-shortid>_api` per [`AGENTS.md`](../../AGENTS.md); changes here should ripple through every example placeholder.
   - Role names (`anon`, `authenticated`, `service_role`, etc.) → the tenant bootstrap SQL.
   - Default values (e.g. `PGRST_DB_SCHEMAS`, JWT TTL) → the config code, not memory.
   - Error codes / error strings → grep the codebase for the throw site. A verbatim error string in the docs should match a stable substring of the source string.
3. **Verify trust and isolation claims against code paths.** "Only the gateway issues runtime JWTs" must trace to a single signing-key boundary in the gateway. "PostgREST is not publicly reachable" must trace to network configuration or Traefik routing. If you cannot find a code path, downgrade the language from absolute to qualified ("in the target topology …") and flag for engineering review.
4. **Verify each example end-to-end where feasible.** For a small example, run it on a scratch project. For a larger one, at minimum verify that every command and every flag exists in `--help` and every URL pattern matches the parser.
5. **Cross-check against `AGENTS.md`.** The root and dashboard `AGENTS.md` are deliberate "non-obvious failure" capture documents. Any docs claim that contradicts an `AGENTS.md` note is a Blocker until the contradiction is resolved.
6. **Sweep for stale references.** Search the page for engine names, image tags, container naming patterns (`flux-<hash>-<slug>-...`), and any short id length. Each must trace to current code.

## Heuristics

- If you cannot find the claim in code, the claim does not belong in the docs as stated.
- A "Probably the case in most setups" claim is fine; an absolute claim ("always", "never", "only") must trace to a single enforced boundary.
- Default values change quietly; treat any default in docs as suspect unless it was verified in this pass.
- Tenant schema name format changes are silent killers — every page that shows `t_<...>_api` must be revisited when the format changes.
- Cross-tenant safety claims should trace to a specific gateway code path; if missing, downgrade.
- A flag listed in `--help` but not referenced by docs is fine. A flag in docs but not in `--help` is a Blocker.

## Common failure modes

- Claimed CLI flag does not exist in `--help`.
- Claimed env var name diverges from the loader code.
- Hostname pattern in docs does not match the regex in the gateway parser.
- Schema name placeholder uses the wrong number of hex characters.
- Default value in docs disagrees with the config code.
- Trust claim cannot be traced to an enforced code path.
- Error code or error string does not appear in the codebase.
- Example assumes an engine, role, or topology that the project under test does not have.

## Output format

A single Markdown report at `docs/_review/reports/<YYYY-MM-DD>-truth-<scope>.md`, following the skeleton in the [`README.md`](README.md) of this directory.

In addition to the standard findings table, a truth pass report **must** include:

```md
## Source-of-truth citations

| Finding | Source location | Observation |
|---------|------------------|--------------|
| TRUTH-1 | apps/cli/src/...:123 | Flag `--foo` not present; doc claims it on `pages/x.md`. |
| TRUTH-2 | gateway/parser.test.ts:45 | Hostname pattern accepts both flattened and dotted, doc only shows flattened. |

## Downgraded claims

- `pages/security/threat-model.md` "always rejects forged tokens" → "rejects forged tokens when gateway signing keys are uncompromised" (added qualifier; underlying enforcement traces to gateway/verify.ts:88).

## Engineering follow-ups

- `apps/cli/...` — flag `--bar` listed in `--help` but unimplemented in the command body. Filed for engineering, not for docs.
```

If no claims required correction, say so explicitly so the report shows the check ran rather than failed silently.

## Relationship to other passes

- Runs after [cognitive-load pass](cognitive-load.md) — there is no point verifying a page the reader cannot follow.
- A truth pass finding sometimes reveals an [IA](ia-review.md) issue (e.g. a claim belongs in a different section). When that happens, file in both reports and prefer to fix the IA first.
- A truth pass finding sometimes reveals a missing definition in [`_contract/terminology.md`](../_contract/terminology.md). File a follow-up to update terminology, then update the page.
- The voice pass should not soften a truth-pass finding into vagueness. If language must be softened, downgrade with the qualifier intact and the source-of-truth citation visible.
