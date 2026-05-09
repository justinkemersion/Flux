# docs/_contract/README.md

# Flux Documentation Contract

This directory defines how Flux documentation is structured, written, and maintained.

These files are not user-facing documentation. They are the authoring contract for the public docs experience.

Flux docs should teach a coherent infrastructure system, not simply list commands.

## Purpose

The documentation contract exists to keep Flux docs:

- conceptually consistent
- progressively disclosed
- technically precise
- calm in tone
- aligned with the current Flux architecture
- free from legacy wording and accidental implementation history

## Required reading before editing docs

Before creating or modifying user-facing documentation, read:

1. `information-architecture.md`
2. `voice.md`
3. `reader-audiences.md`
4. `terminology.md`
5. `page-template.md`
6. `diagrams.md`

## User-facing corpus

Rendered documentation for https://flux.vsl-base.com/docs lives as Markdown in [`docs/pages/`](../pages/). The Next.js dashboard loads those files at runtime; [`docs/_contract/`](../_contract/) remains the authoring constitution.

## Review system

Before writing for a **new feature**, run the [feature intake](../_review/feature-intake.md) pass — six short questions that name the trust contract, audience, page shape, and negative space. The four passes below check that what was written matches the contract; the intake decides what is worth writing.

After editing user-facing docs, run the relevant passes from [`docs/_review/`](../_review/):

1. [IA pass](../_review/ia-review.md) — does the page belong here?
2. [Cognitive load pass](../_review/cognitive-load.md) — can the reader follow it on first read?
3. [Technical truth pass](../_review/technical-truth.md) — do the claims match the code?
4. [Voice pass](../_review/voice-review.md) — does it sound like a calm infrastructure manual?

Scoped passes for [examples](../_review/examples-review.md) and [troubleshooting / error paths](../_review/troubleshooting-review.md) run when those areas change. See [`docs/_review/README.md`](../_review/README.md) for when to run each, the report skeleton, and the suggested order.

## Core rule

Do not let routing, components, CLI flags, or old docs structure define the knowledge model.

Do not write `docs/pages/` as an internal engineering runbook: default reader is the **app builder** on hosted Flux. See `reader-audiences.md` for hosted vs self-hosted tone and forbidden leakage (monorepo paths, deploy scripts as “your” task).

The docs should first answer:

1. What is Flux?
2. Why does it exist?
3. What is the mental model?
4. Why is it trustworthy?
5. How do I build with it?

Reference material supports builders. It is not the onboarding path.