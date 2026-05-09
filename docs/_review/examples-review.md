# docs/_review/examples-review.md

# Examples review pass

This pass confirms pages under [`docs/pages/examples/`](../pages/examples/) deliver what their information-architecture slot promises — and prove coherence rather than describing it.

It is a scoped pass, run when changes touch examples or when an example is referenced from a section that did not previously rely on it.

## Purpose

Catch:

- examples that under-deliver on the responsibilities the IA contract names for their slot
- example slots filled with test fixtures or hostname snippets instead of worked applications
- examples that drift from each other (different fictional projects, different placeholder schema names, different JWT shapes) and so feel like uncoordinated stubs
- examples that defer the substantive content to a repo-only file the reader cannot open
- examples that quietly assume the wrong engine, the wrong reader, or a topology that does not exist

## Trigger

Run this pass when a change does any of the following:

- adds, removes, or rewrites a page under `pages/examples/`
- references an example from a section (introduction, getting-started, concepts, architecture, security, guides, reference) that did not previously link to it
- changes the canonical placeholder schema name, slug, or fictional project name used across examples
- changes the IA contract's promise for the `/examples/` section

## Inputs

Read, in this order:

1. The IA section contract for `/examples/` and each named example slot in [`_contract/information-architecture.md`](../_contract/information-architecture.md).
2. The changed example pages.
3. The other example pages (so cross-example consistency can be checked).
4. Any concept, guide, or getting-started page that links into the changed example.
5. [`AGENTS.md`](../../AGENTS.md) for the canonical schema name format and the canonical sample slug pattern (`bloom-atelier`, etc.) used in tests.

## Method

Apply each step in order. Each finding gets an ID `EX-<n>` and a severity.

1. **Re-read the IA contract for the example slot.** List every responsibility it names. For each, find the part of the example that demonstrates it. A missing responsibility is High; a half-demonstrated one is Medium.
2. **Vertical-slice check.** A worked example should show a real, runnable vertical slice from the reader's perspective: schema → migration → request → expected response. Examples that show only one layer (only SQL, only HTTP, only a hostname) usually belong elsewhere — concept page, guide, or reference — not in `/examples/`. Re-classify rather than rewrite.
3. **Internal consistency check.** Walk all examples together:
   - Same fictional project name when one is named (e.g. `bloom-atelier`) → consistency is High to maintain.
   - Same canonical placeholder schema name format (`t_<12-hex-shortid>_api`) → drift here is High; pick one and update everywhere.
   - Same JWT claim shape (`role`, `sub`, optional `org_id`) → drift here is Medium unless the example deliberately demonstrates a different claim.
4. **No repo-path deferral.** An example that defers the substantive content to a `docs/...md` repo file or any non-`/docs/...` URL fails the pass. Pull the content into the example, or write a smaller honest example.
5. **Engine clarity check.** Each example must make its engine assumption explicit (or note that it works on both). An example that quietly assumes `v1_dedicated` paths in a section that newcomers default to `v2_shared` is High.
6. **Reader-audience check.** Examples address the **app builder** by default. Operator-only setup steps (provisioning, hardening) belong in [`pages/guides/production-hardening.md`](../pages/guides/production-hardening.md) or a labelled callout, not in the example body. Per [`reader-audiences.md`](../_contract/reader-audiences.md).
7. **Length sanity.** An example shorter than the concept page it references is usually too thin. An example longer than its corresponding guide page is usually doing the guide's job; consider promoting parts to the guide.

## Heuristics

- An example is the place the reader expects coherence to "click." If it doesn't, every preceding architecture and security page loses some trust.
- The hardest example to write is the one named after a real project (`bloom-atelier`, etc.). Make sure that page actually shows the named project working — not the parser test that uses the same string.
- An example built around a single SQL block usually wants a guide instead.
- An example that names a JWT issuer (Clerk, Auth.js) usually wants a guide instead.
- A "Simple CRUD" slot is allowed to be intentionally tiny, but it must still be honest end-to-end (table → migration → at least one request, with auth indicated even if minimal).
- Examples that reuse the canonical sample slug from [`AGENTS.md`](../../AGENTS.md) reinforce shared vocabulary across this repo and the user-facing docs. Drift is a missed opportunity.

## Common failure modes

- Example slot is filled with a test fixture (hostname parsing, slug normalization) instead of a worked application.
- Example defers to a repo-only `docs/guides/<file>.md` for the substantive content.
- Examples use three different schema-name placeholders (`t_abc123_api`, `t_shortid_api`, `t_<12hex>_api`) within the same section.
- Example shows SQL but never the resulting HTTP response, leaving the vertical slice incomplete.
- Example assumes `v1_dedicated` connection material when the surrounding pages default to `v2_shared`.
- Example title promises more than the body delivers (e.g. "Multi-tenant app" delivering only an RLS policy).

## Output format

A single Markdown report at `docs/_review/reports/<YYYY-MM-DD>-examples-<scope>.md`, following the skeleton in the [`README.md`](README.md) of this directory.

In addition to the standard findings table, an examples pass report should include:

```md
## IA-promise coverage

| Example | Promised responsibilities | Demonstrated | Missing |
|---------|----------------------------|---------------|---------|
| pages/examples/bloom-atelier.md | auth, migrations, RLS, API, image handling, multi-user | hostname pattern only | auth, migrations, RLS, API, image handling, multi-user |

## Cross-example consistency

| Element | Value(s) found | Canonical | Action |
|---------|-----------------|------------|--------|
| Schema placeholder | t_abc123_api, t_shortid_api | t_<12-hex-shortid>_api | rewrite both with one canonical placeholder |
```

If every example matches its IA promise and the consistency table is clean, say so explicitly.

## Relationship to other passes

- Cross-fires with [IA pass](ia-review.md) when an example's slot or position in the tree is wrong; record in both reports.
- Cross-fires with [technical-truth pass](technical-truth.md) when an example claims behavior the system does not produce.
- The voice and cognitive passes still apply to example pages — they are user-facing pages first, examples second.
