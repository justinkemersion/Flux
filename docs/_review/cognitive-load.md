# docs/_review/cognitive-load.md

# Cognitive load review pass

This pass confirms a docs change can be **followed by the reader on first read, in order**, without needing a second tab open.

It runs after the [IA pass](ia-review.md) and before the [technical-truth pass](technical-truth.md).

## Purpose

Catch:

- terms used before they are defined
- code blocks shown before their purpose is stated
- sections that introduce four or more new ideas without breaking
- prose that drifts away from the primary reader (`reader-audiences.md`)
- "How it works" steps that depend on assumptions the reader has not yet been given
- pages whose surface promise (title, description, "What you will learn") is not delivered by the body

## Trigger

Run this pass when a change does any of the following:

- adds a new user-facing page
- substantively rewrites a "The idea" or "How it works" section
- adds a new code block to a non-reference page
- adds a new term that has not yet been added to [`_contract/terminology.md`](../_contract/terminology.md)
- restructures the order of sections within a page

## Inputs

Read, in this order:

1. [`_contract/voice.md`](../_contract/voice.md) — for the calm-explain-before-instruct expectation.
2. [`_contract/reader-audiences.md`](../_contract/reader-audiences.md) — for the primary-reader test.
3. [`_contract/page-template.md`](../_contract/page-template.md) — for the standard page shape.
4. [`_contract/terminology.md`](../_contract/terminology.md) — to check term coverage.
5. The changed page.
6. The page that links **into** the changed page (caller context).

## Method

Apply each step in order. Each finding gets an ID `COG-<n>` and a severity.

1. **Read the page aloud as the primary reader** named in [`reader-audiences.md`](../_contract/reader-audiences.md) — by default the **app builder on hosted Flux**. After every paragraph, ask: "Did I just need a concept I haven't been given yet?" Mark the sentence; the missing concept is a finding.
2. **List every term used on first appearance.** For each term:
   - Defined inline on this page → fine.
   - Defined in [`_contract/terminology.md`](../_contract/terminology.md) and the page is downstream of where the term was first introduced in the IA → fine.
   - Defined upstream in the IA tree but the page does not link to that definition → Medium (add the link).
   - Not defined anywhere → Blocker (define before use, or add to terminology and link).
3. **Count concepts per section.** A "How it works" or "The idea" section that introduces four or more new ideas without a heading break is a cognitive overload — High.
4. **Inspect order around code.** Every code block must follow at least one sentence stating what it shows, why it shows it, and what changes if the reader substitutes their own values. Code-before-purpose is High.
5. **Check section transitions.** Does each level-2 heading earn its place? A heading whose body is a single sentence is usually a cosmetic break and should be merged into the previous section.
6. **Verify the surface promise.** The page's `title`, `description`, and "What you will learn" bullets are a contract. Walk each bullet — does the body deliver it? Promised-but-not-delivered is High.
7. **Apply the primary-reader test on action verbs.** When the page says "you" do something, can the primary reader actually do it without owning the platform? If the action is operator-only (rebuild image, install OS package on the dashboard host), it must be inside an explicitly labelled operator callout per [`reader-audiences.md`](../_contract/reader-audiences.md).

## Heuristics

- A getting-started page should let the reader succeed end-to-end without opening another tab.
- A reader who understands the page should be able to predict what the next page covers, without clicking.
- A code block whose variables (`<token>`, `<schema>`, `$FLUX_URL`) are not yet defined fails the pass.
- Tables of more than ~6 rows on a non-reference page usually mean the page is doing two jobs.
- Repeated disclaimers across pages ("use your real slug and hash") usually indicate a missing canonical callout that those pages should link to instead.
- A "What you will learn" bullet that mirrors a section heading is usually fine; one that mirrors the page title is usually empty.

## Common failure modes

- A core term (Service URL, Bridge JWT, engine, tenant schema) appears before its definition in the page or upstream IA.
- A code example is shown before the reader knows what they are looking at.
- The reader is told to "use your real slug and hash" with no primer on what those identifiers mean and where to get them.
- "How it works" jumps from concept A to a different mental model (concept B) without bridging.
- The page assumes the reader is on a specific dashboard helper or query string when in fact most readers arrive from search or sidebar nav.
- An action verb addressed to "you" requires platform-level access the primary reader does not have.

## Output format

A single Markdown report at `docs/_review/reports/<YYYY-MM-DD>-cognitive-<scope>.md`, following the skeleton in the [`README.md`](README.md) of this directory.

In addition to the standard findings table, a cognitive pass report should include:

```md
## Term coverage

| Term first appearance | Defined where | Linked from page? |
|-----------------------|----------------|--------------------|
| Service URL | _contract/terminology.md | yes |
| Bridge JWT | concepts/jwt-auth.md | no — add link |

## Reader walk-through

A short, paragraph-level summary of where the primary reader stumbled when the reviewer read the page aloud. One or two paragraphs is enough; this is the most useful artifact for the writer.
```

## Relationship to other passes

- Runs after [IA pass](ia-review.md) — page must belong before its readability is checked.
- Runs before [technical-truth pass](technical-truth.md) — there is no point verifying claims the reader cannot follow.
- Shares the pronoun and persona checks with [voice-review pass](voice-review.md); when both run, the cognitive pass owns "is the reader confused?" and the voice pass owns "does the prose sound right?"
