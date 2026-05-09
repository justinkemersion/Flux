# docs/_review/voice-review.md

# Voice review pass

This pass enforces [`_contract/voice.md`](../_contract/voice.md) and the pronoun, persona, and audience rules in [`_contract/reader-audiences.md`](../_contract/reader-audiences.md).

It is the editorial pass — usually run last, after [IA](ia-review.md), [cognitive-load](cognitive-load.md), and [technical-truth](technical-truth.md) have already shaped the page.

## Purpose

Catch:

- hype words and inflated language the voice contract bans
- ambiguous pronouns ("we") that confuse Flux with the reader
- misuse of "operator" to address the app builder
- named personas that are not codified anywhere
- prose that drifts from a calm infrastructure manual into stand-up update tone
- defensive or reactive framing on philosophy pages

## Trigger

Run this pass when a change does any of the following:

- adds or substantially rewrites prose on any user-facing page
- adds a new section to a security, threat-model, or comparison page (these tend to attract hype or hedge)
- introduces a new persona name or pronoun pattern
- runs alongside the cognitive pass on routine changes (cheap to combine)

## Inputs

Read, in this order:

1. [`_contract/voice.md`](../_contract/voice.md) — the canonical tone rules.
2. [`_contract/reader-audiences.md`](../_contract/reader-audiences.md) — the primary reader and operator boundary.
3. [`_contract/terminology.md`](../_contract/terminology.md) — to confirm terms are used as defined.
4. The changed page.
5. Any page that calls into the changed page (so first-encounter context for the reader is correct).

## Method

Apply each step in order. Each finding gets an ID `VOICE-<n>` and a severity. Most voice findings are Medium; Blockers are reserved for misleading framing or audience leak.

1. **Hype-word scan.** Search the page for the banned vocabulary in [`_contract/voice.md`](../_contract/voice.md): `magical`, `seamless`, `revolutionary`, `supercharged`, `effortless`, `blazing`, `enterprise-grade`, `AI-powered`, `serverless`. Each hit must either be removed or carry justification (e.g. "serverless" used in a technically accurate caller-context paragraph). Bare hype is High.
2. **Pronoun scan.** Count uses of `we`, `our`, `us`. Each is suspect — these pronouns are ambiguous between Flux-the-platform and the reader. Replace with the explicit subject (`Flux`, `the gateway`, `the control plane`, `you`). Persistent first-person plural is High; isolated uses on philosophy pages may be Medium with rewrite suggestion.
3. **Operator-vs-app-builder scan.** Search for `operator`, `operators`, `developer`, `developers`. Per [`reader-audiences.md`](../_contract/reader-audiences.md), the default reader is the **app builder**, and `operator` belongs to a scoped, labelled callout (e.g. `production-hardening` or a `Self-hosted operators` block). Outside those scopes:
   - "Operators typically …" addressing the default reader is High — the app builder is the person doing the action on hosted Flux.
   - "Developers consume the Service URL" usually pairs with the previous error and reinforces an artificial split. Rewrite both together.
4. **Persona scan.** Search for any named persona ("Sarah-the-app-builder", "Justin-the-operator", any other invented person). Personas are useful only when they are codified in [`reader-audiences.md`](../_contract/reader-audiences.md). Uncodified personas appearing on a single page are confusing and should be removed or promoted into the contract. High.
5. **Tone read.** Read the first paragraph of every changed page aloud. Ask:
   - Does it sound like a calm infrastructure manual written by someone who understands the system?
   - Or does it sound like a stand-up update, a launch tweet, or a defensive comparison?
   - Tone drift is Medium unless it actively misleads (then High).
6. **Tradeoff honesty check.** On any page that compares engines, tiers, or strategies (`pooled-vs-dedicated`, `why-flux`, `tenant-isolation`, `threat-model`), confirm the tradeoffs are stated plainly without flattening the weaker option into marketing. Per [`voice.md`](../_contract/voice.md): "Tradeoffs are trust-building." Hidden or softened tradeoffs are High.
7. **First-use term check.** When the page introduces a term defined in [`_contract/terminology.md`](../_contract/terminology.md), confirm it is used consistently with that definition (no informal synonyms, no "v2" used for `v2_shared` outside contexts where the engine name is clear).

## Heuristics

- Use `you` for the app builder. Use `the platform`, `the control plane`, `the gateway`, or `Flux` for what the system runs.
- Avoid `we` unless the writer is genuinely speaking as the Flux team in a philosophy context, and even then prefer the explicit subject.
- "Operator" is reserved for the **self-hosted operator** in [`reader-audiences.md`](../_contract/reader-audiences.md). On hosted Flux, the app builder is not an operator.
- Tradeoffs do not need disclaimers. They are the docs' strongest trust-building tool. State them.
- A sentence that boasts about Flux is usually weaker than the same sentence stating what Flux does and letting the reader conclude.
- A page that begins with "Flux makes …" is usually marketing-shaped. A page that begins with "Flux is …" or "On v2 shared, the gateway …" is usually doc-shaped.

## Common failure modes

- Hype words used without justification.
- "We" used to mean "Flux" without naming Flux.
- "Operators typically …" used in pages aimed at the default reader.
- Named personas appearing on one page only.
- Comparison tables that flatten the weaker option into a marketing-friendly phrase.
- Defensive framing on philosophy pages ("Flux is not just another …") instead of plain identity.
- Inconsistent term usage (`v2`, `v2 shared`, `pooled`, `Pooled` in the same paragraph).

## Output format

A single Markdown report at `docs/_review/reports/<YYYY-MM-DD>-voice-<scope>.md`, following the skeleton in the [`README.md`](README.md) of this directory.

In addition to the standard findings table, a voice pass report should include:

```md
## Hype-word scan

| Term | Page | Context | Action |
|------|------|---------|--------|
| seamless | pages/x.md | "seamless integration" | replace with explicit description |

## Pronoun and persona scan

| Issue | Page | Hits | Action |
|-------|------|------|--------|
| `we` ambiguous | pages/x.md | 3 | replace with `Flux` / `the gateway` |
| `Operators typically` | pages/concepts/projects.md | 1 | rewrite for the app builder |

## Tone read

A short paragraph per changed page describing how the opening reads aloud and whether it matches the calm-manual target.
```

If the page passes all scans cleanly, say so explicitly so the report shows the check ran.

## Relationship to other passes

- Runs after [IA](ia-review.md), [cognitive-load](cognitive-load.md), and [technical-truth](technical-truth.md) — polish on top of a correct, coherent, well-placed page.
- A voice pass must not soften a [truth pass](technical-truth.md) finding into vagueness. If language must be softened, keep the qualifier and the source-of-truth citation visible.
- Pronoun and persona findings often overlap with the cognitive pass's primary-reader test. When both passes run, the cognitive pass owns "is the reader confused?" and the voice pass owns "does the prose sound right?"
