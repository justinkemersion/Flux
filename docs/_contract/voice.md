# docs/_contract/voice.md

# Flux Documentation Voice

Flux documentation should sound like a calm infrastructure manual written by someone who understands the system deeply.

The voice should be:

- precise
- direct
- restrained
- technically literate
- honest about tradeoffs
- migration-first
- PostgreSQL-first
- security-aware

Flux docs should not sound like generic SaaS marketing.

## Prefer

Use direct nouns and concrete system boundaries.

Good:

> Flux v2 projects share infrastructure while remaining isolated at the schema, role, and gateway layers.

Good:

> A Flux project is the deployable backend unit. It includes an API surface, database surface, routing identity, and authentication configuration.

Good:

> Flux does not hide PostgreSQL. SQL migrations are the source of truth.

## Avoid

Avoid vague or inflated language:

- magical
- seamless
- revolutionary
- supercharged
- effortless
- blazing fast
- enterprise-grade, unless specifically justified
- AI-powered, unless directly relevant
- serverless, unless technically accurate in context

Bad:

> Flux magically gives every app a scalable backend.

Better:

> Flux provisions a PostgreSQL-backed REST API and manages the routing, authentication, and project isolation around it.

## Tone principles

### Calm over hype

Flux is impressive because it is coherent, not because the docs shout.

### Explain before instructing

Before giving commands, name the moving parts.

### Tradeoffs are trust-building

Do not hide differences between pooled and dedicated infrastructure.

### Use “boring” as a virtue

Predictability, SQL, HTTP, JWTs, RLS, and PostgREST are strengths.

### Never imply Flux is magic

Flux orchestrates infrastructure. It does not replace understanding.