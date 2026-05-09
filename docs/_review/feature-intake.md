# docs/_review/feature-intake.md

# Feature intake

This is the **pre-writing** pass for a new Flux feature. It runs **before** the IA, cognitive, truth, and voice passes — those check what was written. This pass decides what is worth writing.

It exists because every drift the other passes catch starts as a missing decision: a trust contract that was never named, an audience that was never picked, a future feature that got implied because the doc copied the marketing language. Naming those decisions up front costs minutes; un-naming them after the prose lands costs days.

The pass is intentionally short. Six questions. The answers go into the commit message and the `baselines.md` entry, not into a separate decision document.

## When to run

Run this pass at the moment a new feature becomes a documentation task — typically:

- A new CLI command surface ships in code and now needs a public home.
- A new platform capability (backups, scheduling, observability, etc.) crosses from "implementation detail" into "thing the reader can rely on."
- An existing feature gains a new state, mode, or guarantee that changes its public contract.
- A new audience starts using a feature that was previously documented for a different audience.

Skip it for trivial additions (one new flag on an existing command, a new env var that fits a documented pattern, a new troubleshooting symptom).

## The six questions

Answer each in one or two sentences. The point is not depth; the point is to **name the decision** so it cannot drift silently later.

### 1. What is the public trust contract?

What does this feature **promise** to the reader? State it in the form the reader can act on — not the form the implementation produces. A backup's public contract is not "we run `pg_dump` nightly"; it is "the newest restore-verified backup will restore your project's data into a Postgres of the same major version."

If the answer involves an internal flag or tier name, the answer is not yet public. Translate.

### 2. What internal states remain private?

What does the implementation know that the reader should not need to know? Internal classifier tiers, intermediate pipeline states, retry budgets, queue positions, and feature-flag toggles usually belong here. Naming them privately is not hiding — it is keeping the reader's mental model uncluttered. Privately-named states can still appear inline in troubleshooting (`flux backup list --verbose` exposes seven internal tier names; the concept page exposes three).

### 3. Which audience owns this feature?

Pick one of the audiences in [`reader-audiences.md`](../_contract/reader-audiences.md):

- **App builder** (hosted Flux) — the default reader of `docs/pages/`.
- **Self-hosted operator** — the reader of `guides/production-hardening.md` and a few labelled callouts.
- **Both, with a clean split** — the page is for the app builder; an operator addendum is in production-hardening.

A feature whose default audience is "operator" should usually live in production-hardening, not in a top-level `concepts/` or `guides/` slot. A feature whose default audience is "app builder" should not start with operator framing.

### 4. Is this concept, guide, reference, troubleshooting — or several?

Pick the **smallest** combination that covers the feature without duplication.

- **Concept page** — the feature has vocabulary, trust states, or guarantees that need to be named once and referenced from many places. Backups, JWTs, RLS.
- **Guide page** — the feature has a workflow with concrete steps. Migrations, Auth.js wiring.
- **Reference entry** — the feature is fully captured by a CLI flag, env var, or config field.
- **Troubleshooting entry** — the feature has a recognizable failure shape readers will look up by symptom.

Most features need either a guide alone (workflow only) or a concept-plus-guide pair (workflow plus a trust contract that more than one page references). Avoid splitting prematurely; a single page with two clear sections is better than two thin pages with overlapping prose.

### 5. What promises are intentionally NOT made?

State the negative space. The backup pages explicitly do not promise:

- Cluster-level disaster recovery on v2 shared.
- Restoring a v2 tenant export into a different engine without it being a migration.
- That an offsite-replicated backup is restorable until it has been restore-verified against the offsite bytes.

Naming non-promises in the docs is what stops them from being implied by silence. The reader who reads "we maintain backups" assumes more than the reader who reads "Flux maintains backup machinery; you maintain backup policy."

### 6. What future commands or features are intentionally not implied?

If the feature is partial — a CLI surface that will gain commands later, a tier that will gain capabilities — say so explicitly in the docs, **not** by mentioning future commands as if they exist. The backup guide says "There is no `flux backup restore` command today" rather than describing one that is coming.

This is the question that protects readers from confidently using a feature that is not yet there. It is also the question that lets the next feature pass land cleanly: when `flux backup restore` ships, the docs change is one section update, not a credibility recovery.

## Output format

The six answers go in two places:

1. **The commit message** for the docs change. The backup commit (`5038af7`) is the canonical example: trust language and page-shape decisions appear inline in the body, with a one-table summary of decisions and rejected alternatives. This makes the decision auditable from `git log`.
2. **The next `baselines.md` entry**. Use the same two-column "Decision / Alternative rejected" table the backup baseline uses. This makes the decision auditable from the docs themselves.

If the feature is large enough to warrant a snapshot report, the answers go at the top of the report under an "Intake" section, before the findings table.

## Heuristics

- A page that needs to explain a feature's "stages" or "tiers" before describing what it does is missing question 2 (private states leaking into public copy).
- A page that uses "we" to describe operator behavior is missing question 3 (the audience handoff is implicit, so the prose splits the difference).
- A page that adds a feature without saying what it does **not** do is missing question 5 (the silent space gets filled by the reader's prior assumptions, often wrongly).
- A page that mentions a future capability in present tense is missing question 6 (the feature works today everywhere except in the place the reader is reading about it).

## Common failure modes

- **Skipping intake on "just a small feature."** The feature ships, the docs land, and three weeks later a finding from the technical-truth pass discovers the trust contract is wrong because nobody named it.
- **Naming the implementation, not the contract.** The page describes what the system does internally, leaving the reader to infer the public guarantee. Rewrite the question-1 answer until it is something the reader can act on without knowing the implementation.
- **One-page-fits-all.** A guide that also defines the trust contract becomes the canonical reference for both — and then the trust contract drifts when a future page links to "the workflow" but actually relies on the inline definitions.
- **Future-tense leakage.** "When `flux backup restore` is available..." in a doc that ships before the command does. The doc reads as instruction; the reader follows it; the command is missing.

## Relationship to other passes

- This pass runs **before** writing. The four standard passes (IA, cognitive, truth, voice) run **after** writing. The order is intake → write → IA → cognitive → truth → voice.
- A failed intake (the team cannot answer one of the six questions in plain English) is itself a finding: the feature is not yet ready to document. That is a useful signal — better to discover it before prose, not after.
- Examples coverage and troubleshooting passes still run in their own scope; intake does not replace them. Intake is the contract; those passes check that the contract is being lived out.

## Worked example

The clean trace of this pass run end-to-end is the backup-doc rollup recorded in [`baselines.md`](baselines.md) under "Backups feature surfaced in docs (mid-cycle addition)" and committed as `5038af7`. The two intake decisions (page-shape, trust-language) were made before the prose, recorded in the commit body, and live in the baseline table. That is the shape every future feature intake should follow.
