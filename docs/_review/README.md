# docs/_review/README.md

# Flux Documentation Review System

This directory defines the **review passes** that user-facing Flux documentation goes through before and after substantive change.

These files are not user-facing documentation. They are the rubrics a reviewer (human or model) follows to keep `docs/pages/` honest, navigable, and trustworthy.

The authoring constitution lives in [`docs/_contract/`](../_contract/). The review passes here check that the constitution is being lived out.

## Purpose

Authoring contracts describe **what good looks like**. Review passes describe **how to check that the work matches**.

Without the review system, the contract slowly drifts: pages describe behavior the code no longer has, examples promise more than they deliver, troubleshooting paths point at repo files the reader can't open, and the calm voice slides into stand-up notes.

The review system exists to make drift visible and cheap to fix.

## Pre-writing pass

Before any of the post-writing passes, a new feature runs through [`feature-intake.md`](feature-intake.md). It is six short questions that name the trust contract, the audience, the page shape, and the negative space — the decisions every other pass downstream assumes were made. Skipping intake is the cheapest way to make the four standard passes find work later that should have been settled in minutes up front.

## The four standard passes

Each post-writing pass is independent. Each has its own rubric file. A "major docs change" runs the first three; the editorial pass is optional but recommended before a release.

| # | Pass | Rubric | Typical model | Always required? |
|---|------|--------|---------------|------------------|
| 1 | Information architecture | [`ia-review.md`](ia-review.md) | Sonnet | Yes |
| 2 | Cognitive load | [`cognitive-load.md`](cognitive-load.md) | Sonnet | Yes |
| 3 | Technical truth | [`technical-truth.md`](technical-truth.md) | Opus | Yes |
| 4 | Editorial | [`voice-review.md`](voice-review.md) | Sonnet | Optional, before release |

Two further rubrics handle scoped changes:

| Pass | Rubric | When to run |
|------|--------|--------------|
| Examples coverage | [`examples-review.md`](examples-review.md) | Any change under `pages/examples/` |
| Troubleshooting / error paths | [`troubleshooting-review.md`](troubleshooting-review.md) | Any new error symptom or change to gateway / PostgREST / auth behavior |

## What counts as a "major docs change"

- Any new page in `docs/pages/`.
- Any moved or renamed page.
- Any change that introduces or modifies a CLI flag, env var, hostname pattern, role name, schema name, or trust claim.
- Any change to architecture, security, or threat-model pages.
- Any rewrite that touches more than a paragraph in a concept page.

Trivial typo fixes, link refreshes, and frontmatter housekeeping do not require the full pipeline — but should still pass the cognitive and voice rubrics quickly.

## Running a pass

Each rubric file follows the same shape:

1. **Purpose** — what this pass exists to catch.
2. **Trigger** — when to run it.
3. **Inputs** — what to read before forming findings.
4. **Method** — the procedure, in order.
5. **Heuristics** — concrete checks the reviewer applies.
6. **Common failure modes** — anti-patterns this pass surfaces.
7. **Output format** — how findings are recorded.

A reviewer (human or model) follows the method, applies the heuristics, and produces a findings document.

## Output format

Every pass produces a single Markdown report with this skeleton:

```md
# <Pass name> — <YYYY-MM-DD> — <scope>

**Reviewer:** <person or model>
**Inputs:** <files / commits / branches read>
**Outcome:** <pass | pass with follow-ups | block>

## Findings

| ID | Severity | Page | Finding | Suggested fix |
|----|----------|------|---------|---------------|
| <prefix>-1 | High | pages/x | ... | ... |

## Open questions

- ...

## Notes
```

Severity scale, used consistently across passes:

- **Blocker** — a reader is misled, a link is broken, a claim is false. Fix before merge.
- **High** — a reader is friction-bumped, a section under-delivers on its IA promise. Fix in the same change cycle.
- **Medium** — drift from contract, or a clarity issue that doesn't mislead. Fix in a follow-up.
- **Low** — polish. Track in a backlog.

ID prefixes are per-pass: `IA-`, `COG-`, `TRUTH-`, `VOICE-`, `EX-`, `TROUBLE-`.

## Where reports live

Snapshot reports for a specific pass go under `docs/_review/reports/<YYYY-MM-DD>-<pass>-<scope>.md`. The rubric files in this directory stay stable; reports accumulate as the docs change. The `reports/` folder is created on first use; this README does not require it to exist.

## Relationship to the authoring contract

- The [`_contract/`](../_contract/) files are the constitution: what to write.
- The `_review/` files are the bench: how to check what was written.
- A pass should never invent rules. If a finding requires a new rule, it goes into the relevant `_contract/` file first, then the pass enforces it.

## When a pass disagrees with the contract

- Finding wins until the contract is updated. File a follow-up to update the contract so the next pass starts aligned.
- Do not silently soften the contract from inside a pass report.

## Suggested order in a single change

0. **Feature intake** (new features only) — answer the six questions in [`feature-intake.md`](feature-intake.md) before writing.
1. **IA pass** first — without a stable home, every other check is wasted.
2. **Cognitive pass** second — once the page belongs, make sure the reader can follow it.
3. **Truth pass** third — once the prose is coherent, verify it against the system.
4. **Editorial / voice pass** last — polish on top of a correct, coherent, well-placed page.

Run examples and troubleshooting passes inline with the others when the change touches their scope.
