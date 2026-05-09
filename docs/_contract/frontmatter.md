# docs/_contract/frontmatter.md

# Flux frontmatter contract

Every user-facing documentation page in [`docs/pages/`](../pages/) must include frontmatter.

Frontmatter exists to define:

- document identity
- section membership
- summary metadata
- disclosure hierarchy

Frontmatter should NOT define:

- visual styling
- layout behavior
- rendering mechanics
- component selection
- arbitrary UI flags

Flux documentation remains content-first. Frontmatter is the smallest stable surface needed for navigation, search, lint, and review tooling — nothing more.

## Required fields

Every page must include:

```yaml
---
title:
description:
section:
---
```

### `title`

Human-readable page title. Used in the rendered page header, browser tab, and search results.

- **Type:** string.
- **Length:** keep under ~60 characters so it doesn't truncate in tab and search UIs.
- **Style:** sentence case (`What is Flux?`, not `What Is Flux?`).
- **Stability:** treat as a stable identifier. Renaming a `title` changes how the page is found in search; coordinate with the [IA pass](../_review/ia-review.md) when retitling.

### `description`

One-sentence summary of what the page covers. Used in search snippets, link previews, and `<meta name="description">` if the renderer wires it through.

- **Type:** string.
- **Length:** roughly 80–160 characters. Long enough to disambiguate, short enough to render cleanly in previews.
- **Style:** declarative, factual, calm. Avoid marketing language (per [`voice.md`](voice.md)).
- **Quoting:** quote the value if it contains a colon, single quote, or other YAML-significant character (`description: "v1, v2: how Flux engines differ"`).

### `section`

The IA section the page belongs to. Used by the renderer for navigation grouping, by the [IA pass](../_review/ia-review.md) for tree validation, and by lint tooling.

- **Type:** string, kebab-case.
- **Allowed values:** the directory the file lives in under `docs/pages/`. One of:
  - `introduction`
  - `getting-started`
  - `concepts`
  - `architecture`
  - `security`
  - `guides`
  - `examples`
  - `reference`
- **Root page exception:** `docs/pages/index.md` does not require `section` because it is the root entry point and belongs to no group. All other pages require it.
- **Stability:** changing a page's `section` is an IA tree change; run the [IA pass](../_review/ia-review.md) when moving a page between sections.

## Optional fields

These fields are not required, but the renderer and review tooling recognize them when present.

```yaml
---
order:
tags:
status:
---
```

### `order`

Numeric ordering hint within a section. **Optional.** The renderer should fall back to filesystem order or alphabetical-by-`title` when `order` is absent.

- **Type:** integer.
- **Use sparingly.** Filesystem hierarchy (`docs/pages/<section>/<slug>.md`) is the canonical ordering system. Add `order` only when the natural sort produces the wrong reader path and the page cannot be renamed.
- **Avoid backfill.** Adding `order` everywhere creates duplication, drift, and contributor hesitation. The `2026-05-08` baseline pass deliberately rejected blanket `order` backfill (see [`baselines.md`](../_review/baselines.md) → "Decisions of record").

### `tags`

Free-form labels for cross-cutting topics that don't map cleanly to a single `section`. Useful for renderer-side faceted search.

- **Type:** YAML list of strings.
- **Style:** kebab-case, short. Examples: `[rls, auth, jwt]`, `[migrations, sql]`, `[tls, runtime]`.
- **Discipline:** add a tag only when the page is genuinely about it. Tag spam is worse than no tags.

### `status`

Lifecycle marker for pages that are not yet stable.

- **Type:** string. One of: `draft`, `experimental`, `deprecated`, `stable` (default if omitted).
- **Use:** mark `draft` when a page is partially written but useful enough to publish; mark `deprecated` when content has been superseded but not yet removed (with a link in the body to the replacement).

## Examples

Minimum viable frontmatter:

```yaml
---
title: First request
description: Make a successful HTTP call to your project API on v1 dedicated or v2 shared.
section: getting-started
---
```

With optional fields:

```yaml
---
title: Auth.js with Flux
description: Patterns for Next.js Auth.js sessions, JWTs, and Postgres RLS with Flux v2 shared.
section: guides
tags: [auth, jwt, nextjs]
status: stable
---
```

Root page (`pages/index.md`) — `section` omitted by exception:

```yaml
---
title: Flux documentation
description: PostgreSQL-first backend platform with managed projects, REST APIs, migrations, JWTs, and row-level security.
---
```

## Validation

A linter or pre-commit hook should reject:

- a page in `docs/pages/` (other than `index.md`) without `title`, `description`, or `section`
- a `section` value that does not match the page's directory
- a `status` value not in the allowed list
- a `description` longer than ~200 characters or shorter than ~30

These rules are enforceable by the [IA pass](../_review/ia-review.md) when run; codifying them in CI is an optional follow-up.

## Relationship to other contracts

- [`_template.md`](_template.md) — copy-paste starting point for new pages. Must agree with this file.
- [`information-architecture.md`](information-architecture.md) — defines what `section` values are valid and how they map to the navigation tree.
- [`voice.md`](voice.md) — governs the tone of `title` and `description`.
- [`../_review/ia-review.md`](../_review/ia-review.md) — the pass that enforces frontmatter consistency.

## Reconciliation history

- **2026-05-08** — `order` removed from required fields; `section` confirmed required and backfilled across the corpus. See [`../_review/baselines.md`](../_review/baselines.md).
