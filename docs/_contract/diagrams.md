
```md
# docs/_contract/diagrams.md

# Flux Diagram Contract

Flux diagrams should make system boundaries understandable.

They should not decorate the docs. They should reduce cognitive load.

## Diagram style

Use simple boxes and arrows.

Prefer text-first diagrams that can later become SVG or React diagrams.

Avoid decorative architecture art that does not teach.

## Canonical diagrams

### 1. System Overview

Purpose:

Show the relationship between:

- application
- Flux Gateway
- control plane
- PostgREST
- PostgreSQL
- tenant/project boundary

Should answer:

> What are the main parts of Flux?

### 2. Request Lifecycle

Purpose:

Show one application request moving through Flux.

Canonical flow:

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