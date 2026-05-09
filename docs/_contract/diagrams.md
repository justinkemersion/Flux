# docs/_contract/diagrams.md

# Flux diagram contract

Flux diagrams should make system boundaries understandable.

They should not decorate the docs. They should reduce cognitive load.

## Scope

This contract covers **text-first ASCII diagrams** rendered as fenced code blocks inside Markdown pages. SVG, image, or React-component diagrams are out of scope and should not ship in `docs/pages/` until this contract is updated to cover them.

The `docs/assets/diagrams/` folder is reserved for future image assets when (and if) the renderer adopts them; today it is intentionally empty.

## Style

Use simple boxes and arrows. Prefer ASCII flow over Unicode box-drawing characters; ASCII renders consistently in every code block, terminal, and pull request preview.

Avoid decorative architecture art that does not teach. A diagram should answer one question; if it answers two, split it into two diagrams.

## Canonical diagrams

The diagrams listed below are the **canonical set** referenced from multiple pages. When the underlying system changes, update the canonical diagram first, then sweep the pages that include it.

### 1. System overview

**Purpose.** Show the relationship between application traffic, the Flux gateway, the control plane, PostgREST, PostgreSQL, and the tenant/project boundary.

**Answers.** *What are the main parts of Flux?*

**Canonical home.** [`pages/introduction/mental-model.md`](../pages/introduction/mental-model.md). Other pages should summarize and link, not redraw.

### 2. Request lifecycle

**Purpose.** Show one application request moving through Flux on the v2 shared engine.

**Answers.** *What happens between my fetch and my data?*

**Canonical flow:**

```txt
App / Browser
  ↓
Project JWT
  ↓
Flux Gateway
  ↓
Project verification
  ↓
Bridge JWT
  ↓
PostgREST
  ↓
Tenant schema
  ↓
PostgreSQL
```

**Canonical home.** [`pages/architecture/request-flow.md`](../pages/architecture/request-flow.md). The same flow is referenced (not redrawn) from `pages/introduction/mental-model.md`, `pages/architecture/gateway.md`, `pages/architecture/bridge-jwts.md`, and `pages/security/threat-model.md`.

### 3. Tenant isolation layout

**Purpose.** Show the structural difference between v1 dedicated and v2 shared at the network, database, API, and edge layers.

**Answers.** *Where is the tenant boundary, structurally?*

**Canonical home.** [`pages/architecture/tenant-isolation.md`](../pages/architecture/tenant-isolation.md). Currently rendered as a comparison table; promoting to an ASCII diagram is an open follow-up.

## Rules

### Diagrams reduce cognitive load

If a diagram makes a page harder to skim, remove it. Diagrams earn their space by answering a single specific question the surrounding prose does not answer as efficiently.

### One canonical home per diagram

Every canonical diagram lives on exactly one page. Other pages reference and link, but do not duplicate. Duplication creates drift the next time the system changes.

### Update upstream first

When the underlying system changes, update the canonical diagram and its home page before sweeping the pages that link to it. Otherwise the docs briefly show two contradictory pictures.

### Text-first, future-friendly

Keep diagrams as ASCII inside fenced code blocks. If a diagram genuinely needs SVG (multi-edge layouts, color-coded zones), update this contract first to define the SVG conventions, then add the asset under `docs/assets/diagrams/`.

## Anti-patterns

Do NOT:

- Decorate a page with a diagram that adds no answer.
- Redraw a canonical diagram on a non-canonical page.
- Use Unicode box-drawing characters that render inconsistently across surfaces.
- Embed binary images (`.png`, `.jpg`) in `docs/pages/` while this contract is text-first.
- Show internal monitoring topology, container names, or platform-engineer-only state in a default-reader diagram (per [`reader-audiences.md`](reader-audiences.md)).

## Relationship to other contracts

- [`information-architecture.md`](information-architecture.md) — names which sections rely on which canonical diagrams.
- [`voice.md`](voice.md) — diagram captions and surrounding prose follow the same calm-manual tone.
- [`../_review/ia-review.md`](../_review/ia-review.md) — checks that diagrams are referenced from valid canonical homes when they appear on multiple pages.
