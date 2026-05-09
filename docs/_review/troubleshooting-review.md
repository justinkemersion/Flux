# docs/_review/troubleshooting-review.md

# Troubleshooting review pass

This pass confirms that error symptoms have a documented home, that the path from "I see X" to "fix Y" is short and accurate, and that hosted-vs-self-hosted responsibility is honestly assigned.

It is a scoped pass, run when changes touch error paths or when the canonical troubleshooting page changes.

## Purpose

Catch:

- error symptoms scattered across many pages with no canonical home
- error symptoms in the troubleshooting page that the system can no longer produce
- hosted-vs-self-hosted advice that points the wrong reader at the wrong fix
- repo paths or container names leaked into reader-facing troubleshooting
- error strings cited verbatim that no code path emits
- duplication of full causes/resolutions across pages instead of links into a canonical entry

## Trigger

Run this pass when a change does any of the following:

- adds, removes, or rewrites the troubleshooting page (for example `pages/reference/troubleshooting.md` once it exists)
- adds a new error symptom (status code, SQLSTATE, error string) anywhere in `docs/pages/`
- changes the gateway, PostgREST, control plane, CLI, or auth behavior in a way that changes the error a reader sees
- adds or removes a "Common errors" callout on any non-troubleshooting page
- changes the hosted-vs-self-hosted boundary in [`_contract/reader-audiences.md`](../_contract/reader-audiences.md)

## Inputs

Read, in this order:

1. [`_contract/reader-audiences.md`](../_contract/reader-audiences.md) — for the hosted-vs-self-hosted rule.
2. [`_contract/voice.md`](../_contract/voice.md) — to keep error pages calm rather than alarmist.
3. The canonical troubleshooting page when it exists.
4. Every page that ships a "Common errors" or similar block. At time of writing those include `pages/getting-started/first-request.md`, `pages/introduction/mental-model.md`, `pages/architecture/request-flow.md`, `pages/architecture/bridge-jwts.md`, `pages/security/rls-boundaries.md`, `pages/guides/v2-to-v1-migrate.md`. Update this list as the docs grow.
5. The codebase locations that throw or surface the errors in question (gateway, PostgREST config, CLI commands, control plane handlers).
6. [`AGENTS.md`](../../AGENTS.md) for the canonical "non-obvious failure" notes already captured for cross-repo readers.

## Method

Apply each step in order. Each finding gets an ID `TROUBLE-<n>` and a severity.

1. **Inventory error symptoms across `pages/`.** Build a flat list of every status code, SQLSTATE, and quoted error string mentioned anywhere in the docs. For each:
   - Is it cataloged in the canonical troubleshooting page, with cause, resolution, and engine scope?
   - If it appears in a non-troubleshooting page, does that page link to the canonical entry rather than repeat the cause/resolution?
   - Missing canonical entry → High; duplicated cause/resolution outside the canonical entry → Medium.
2. **Verify the canonical troubleshooting entries are still reachable in production.** For each entry, find the throw site or surface in code (or note that it lives in PostgREST / Postgres directly). Entries the system can no longer produce are Medium — mark for archive or rewrite.
3. **Hosted-vs-self-hosted split check.** Each entry must say which reader is responsible:
   - Hosted: app builder verifies env wiring, then **contacts support** if the underlying issue is platform-side. They do not edit Dockerfiles or install OS packages.
   - Self-hosted: operator follows a short, explicit checklist (install tooling in the dashboard/control-plane runtime, rebuild, restart). Repo paths are acceptable here only when they help the operator, and only inside an explicitly labelled callout.
   - A symptom whose only resolution path tells the app builder to rebuild a container is a Blocker — the page is addressing the wrong reader.
4. **Repo-path leak check.** No reader-facing entry may carry `apps/...`, `packages/...`, `bin/...`, `Dockerfile`, source filenames, or TypeScript symbol names in the default flow. These belong only inside `Self-hosted operators` callouts (per [`reader-audiences.md`](../_contract/reader-audiences.md)). Each leak is High.
5. **Error-string fidelity check.** When the docs quote an error string verbatim (`role "service_role" does not exist`, `invalid command \restrict`, etc.), grep the codebase or the surfaced library for a matching substring. Drift between quoted string and the real source is Medium — update the quote, do not invent.
6. **Engine-scope check.** Each entry must say which engine it applies to (`v1_dedicated`, `v2_shared`, both). Reader confusion comes from advice that silently assumes one engine.
7. **Resolution length check.** A canonical entry's resolution should be short enough to act on without scrolling. If a resolution requires more than a few steps, link to a guide rather than expanding the entry.

## Heuristics

- The reader looking up `42501` is already stuck. The page should answer "what does it mean, who owns the fix, what's the next click" in three short paragraphs at most.
- A "contact support" path is correct for a hosted reader when the cause is a platform-packaging issue. It is wrong when the cause is something the reader can fix in their own env (`AUTH_SECRET`, JWT claim shape, missing GRANT).
- A page that owns an error class should also own its examples. Spreading the same entry across multiple pages dilutes the canonical home.
- Calm tone matters more on troubleshooting pages than anywhere else — a stressed reader does not need exclamation marks.
- A "Common errors" block on a non-troubleshooting page should usually be three rows or fewer, each linking into the canonical entry.

## Common failure modes

- Status codes and SQLSTATEs cataloged in two or three places with different causes named.
- Hosted reader is told to install OS packages or rebuild containers (responsibility leak).
- Self-hosted operator advice buried inside a hosted-flow paragraph instead of in a labelled callout.
- Quoted error string differs from the real source string by enough to make `grep` fail for the reader.
- Entry assumes `v2_shared` while sitting next to entries that assume `v1_dedicated`, with no engine label on either.
- Canonical entry resolution is multi-page and unscannable.

## Output format

A single Markdown report at `docs/_review/reports/<YYYY-MM-DD>-troubleshooting-<scope>.md`, following the skeleton in the [`README.md`](README.md) of this directory.

In addition to the standard findings table, a troubleshooting pass report should include:

```md
## Symptom inventory

| Symptom | Pages mentioning it | Canonical entry exists? | Engine | Owner (hosted / self-hosted) |
|---------|----------------------|--------------------------|--------|-------------------------------|
| 401 at the gateway | first-request, mental-model, bridge-jwts | yes (reference/troubleshooting#401) | both | app builder |
| `42501` permission denied | first-request, mental-model, rls-boundaries | yes | both | app builder |
| `pg_dump not found` | guides/v2-to-v1-migrate, guides/production-hardening | yes | both | hosted: support; self-hosted: operator |

## Source-of-truth citations for quoted error strings

| Quoted string | Source location | Match? |
|----------------|------------------|--------|
| `role "service_role" does not exist` | postgres bootstrap path | yes (substring) |
```

If the troubleshooting page already covers every symptom found, with correct hosted/self-hosted owners and accurate quotes, say so explicitly.

## Relationship to other passes

- Cross-fires with [IA pass](ia-review.md) when a symptom is mentioned but no canonical entry exists yet — the canonical entry is itself a tree decision.
- Cross-fires with [technical-truth pass](technical-truth.md) when a quoted error string drifts from code, or when an entry describes a code path that no longer exists.
- The voice pass still applies to troubleshooting prose — calm framing matters more here than anywhere else.
