# docs/_review/ia-review.md

# IA review — information architecture pass

This pass confirms a docs change still fits the canonical tree, ordering, and disclosure model defined in [`_contract/information-architecture.md`](../_contract/information-architecture.md).

It is the **first** pass run on any major change. Without a stable home for a page, every other check is wasted.

## Purpose

Catch:

- pages that exist but are not in the canonical tree (orphans)
- cross-section links that skip the natural disclosure stair
- "Next steps" blocks that send the reader backwards
- new pages that duplicate a concept already canonicalized elsewhere
- broken links to pages that do not exist in `docs/pages/`

## Trigger

Run this pass when a change does any of the following:

- adds a new page in `docs/pages/`
- moves or renames a page
- adds a new section to the canonical tree
- adds cross-links between sections
- changes a page's `section` or `order` frontmatter
- changes the homepage navigation in `pages/index.md`

## Inputs

Read, in this order:

1. [`_contract/information-architecture.md`](../_contract/information-architecture.md) — the canonical tree and per-section purpose.
2. [`_contract/reader-audiences.md`](../_contract/reader-audiences.md) — to confirm each page targets the primary reader unless explicitly scoped otherwise.
3. The changed pages.
4. Each page's immediate neighbors (next and previous in section, parent index).
5. `pages/index.md` for top-level navigation.
6. The set of broken cross-links found by a quick grep for `/docs/...` paths against actual files in `pages/`.

## Method

Apply each step in order. Each finding gets an ID `IA-<n>` and a severity.

1. **Locate the page in the canonical tree.** If it is not in the tree, decide: add it to the tree (and update [`_contract/information-architecture.md`](../_contract/information-architecture.md) as a follow-up) or relocate the page. An orphan is a Blocker.
2. **Match reader state.** Each section in the IA contract names a reader state (e.g. `confused → curious`, `trusting`). Verify the page's tone and disclosure depth match its section's state. Mismatch is High.
3. **Walk every outgoing link.** For each link in the page body and "Next steps":
   - Does it resolve to a `pages/...` URL or to a repo path? Repo paths in the body of a default-reader page are a Blocker (see [`reader-audiences.md`](../_contract/reader-audiences.md)).
   - Does the target page exist? Missing target is a Blocker.
   - Does the target page's section make sense as the next stop in the disclosure model? Backward jumps to less-detailed pages are High; sideways jumps are Medium and need justification in the next-steps text.
4. **Walk incoming links.** Find every page that links into the changed page. Are the callers from sections that should logically lead here? An architecture page linked from getting-started without a bridging concept is High.
5. **Apply the IA anti-patterns checklist.** Cross-check the page against the "Anti-Patterns To Avoid" section in [`_contract/information-architecture.md`](../_contract/information-architecture.md). Each match is at least Medium.
6. **Check for duplication.** If the page restates a concept that has a canonical home elsewhere (per the IA tree), it should summarize and link, not redefine. Duplicate canonical explanations are High.
7. **Sanity-check the homepage.** If `pages/index.md` changed, verify the table still routes new readers to the introduction → getting-started → concepts arc, not directly to reference pages.

## Heuristics

- A getting-started page should not link forward to architecture as a primary next step.
- A reference page should not be the first or only link from a guide's body.
- Every concept should have one canonical home; guides may summarize but must link to the canonical concept page.
- A page that is the only one in its section is suspect — either the section is premature or the page belongs elsewhere.
- A page whose "Next steps" sends the reader to three different sections has unclear job-to-be-done; pick the strongest two.
- A canonical example slot ([`/examples/...`](../pages/examples/)) should match the responsibilities the IA contract names for that slot. If it doesn't, defer the deeper check to the [examples-review pass](examples-review.md) and record the mismatch here as High.

## Common failure modes

- Page exists but is missing from the canonical tree (orphan).
- Cross-section link skips the natural disclosure stair (e.g. introduction → reference).
- "Next steps" sends the reader backwards or sideways without explanation.
- The page links to a repo path (`docs/...md`, `apps/...`, `packages/...`) instead of a `/docs/...` URL.
- Two pages independently define the same concept; neither links to the other.
- Architecture or security content is buried inside a guide instead of living in its dedicated section.

## Output format

A single Markdown report at `docs/_review/reports/<YYYY-MM-DD>-ia-<scope>.md`, following the skeleton in the [`README.md`](README.md) of this directory.

In addition to the standard findings table, an IA pass report should include:

```md
## Tree changes

- Add `pages/<path>` under section `<section>` (justification: ...).
- Move `pages/<path>` to `pages/<new-path>` (justification: ...).
- No tree changes required.

## Broken links found

- `pages/x.md` → `/docs/y` (target missing or not in `pages/`).
```

If no tree changes are needed and no broken links exist, say so explicitly so the reader of the report knows the check ran.

## Relationship to other passes

- This pass runs before [cognitive-load](cognitive-load.md) — there is no point checking how a page reads if it is in the wrong place.
- This pass surfaces but does not fix factual errors; those are the [technical-truth pass](technical-truth.md)'s job.
- This pass surfaces but does not fix tone issues; those are the [voice-review pass](voice-review.md)'s job.
- This pass cross-fires with [examples-review](examples-review.md) when an example doesn't deliver what its IA slot promises — record the mismatch in both reports if both passes run.
