# Flux Documentation Information Architecture

This file defines the canonical documentation tree, ordering principles, disclosure model, and conceptual teaching flow for Flux documentation.

It is the source of truth for:

- what Flux documentation teaches
- the order concepts are introduced
- how users move through the docs
- where architecture and trust explanations live
- how practical workflows connect back to the mental model

This file does NOT define:

- styling
- React components
- MDX implementation
- routing framework details
- search infrastructure
- UI composition
- deployment strategy

The purpose of this contract is to ensure Flux documentation remains coherent as the platform evolves.

---

# Core Documentation Philosophy

Flux documentation should teach a coherent infrastructure system.

The docs are not:

- a dashboard help center
- a collection of CLI commands
- a generated API reference
- a marketing website disguised as docs

Flux documentation exists to help users:

1. understand the system
2. trust the system
3. build with the system
4. operate the system confidently

The documentation should progressively reveal complexity.

Concepts come before mechanics.
Architecture comes before optimization.
Reference comes after understanding.

## Reader audiences

`docs/pages/` is written first for the **app builder** (hosted Flux): product vocabulary, actions they control (CLI, dashboard, app env). Platform packaging, monorepo paths, and deploy runbooks must not read as that reader’s homework. See [`reader-audiences.md`](reader-audiences.md) for hosted vs self-hosted rules and anti-patterns.

---

# Global Reader Journey

The entire documentation system is designed around the following emotional and cognitive progression:

```txt
confused
→ curious
→ impressed
→ trusting
→ building
```

Each section of the docs contributes to this progression.

---

# Emotional Architecture

## 1. Confused

The reader needs:

* a clear explanation of what Flux is
* a simple mental anchor
* reassurance that the system is understandable

The docs should:

* define terms carefully
* avoid implementation noise
* avoid giant configuration tables
* avoid unexplained acronyms
* reduce perceived complexity

---

## 2. Curious

The reader asks:

> How does this actually work?

The docs should:

* explain the mental model
* explain the major moving parts
* introduce request flow
* show believable system structure
* connect ideas before commands

Commands should reinforce understanding, not replace it.

---

## 3. Impressed

The reader realizes:

> This system is coherent.

The docs should surface:

* PostgreSQL-first architecture
* migration-first workflow
* JWT + RLS integration
* pooled isolation model
* dedicated infrastructure model
* deliberate tradeoffs
* Flux philosophy

The docs should not attempt to impress through hype.

The system itself should create confidence.

---

## 4. Trusting

The reader asks:

> What are the boundaries?
> What guarantees exist?
> What is shared?
> What is isolated?
> What signs what?

The docs should:

* explain architecture precisely
* explain security boundaries
* explain pooled vs dedicated honestly
* explain gateway behavior
* explain JWT trust flow
* explain RLS responsibilities
* explain where Flux stops and PostgreSQL begins

Trust comes from clarity, not marketing.

---

## 5. Building

The reader asks:

> How do I ship with this?

The docs should provide:

* guides
* examples
* workflows
* operational references
* CLI reference
* env var lookup
* implementation patterns

Reference exists to support builders, not onboard them.

---

# Documentation Disclosure Model

Flux documentation follows progressive disclosure.

The system should move from:

```txt
identity
→ concepts
→ architecture
→ workflows
→ reference
```

The user should rarely encounter exhaustive mechanics before understanding the system.

---

# Canonical Documentation Tree

```txt
/docs

  /introduction
    what-is-flux
    why-flux
    mental-model

  /getting-started
    installation
    create-project
    first-request
    auth

  /concepts
    projects
    migrations
    jwt-auth
    rls
    pooled-vs-dedicated
    service-urls

  /architecture
    flux-v2
    gateway
    bridge-jwts
    tenant-isolation
    request-flow

  /security
    authentication-model
    tenant-isolation
    rls-boundaries
    project-secrets
    threat-model

  /guides
    authjs
    nextjs
    clerk
    migrations
    production-hardening

  /examples
    bloom-atelier
    simple-crud
    multi-tenant-app

  /reference
    cli
    env-vars
    config
    troubleshooting
```

---

# Section Contracts

---

# /docs (root)

## Purpose

The docs homepage introduces Flux and routes users into the correct learning path.

It is not a giant link dump.

It should answer:

> What is Flux?
> Why does it exist?
> Where should I begin?

---

## Reader State

```txt
confused → curious
```

---

## Root Page Responsibilities

The root page should include:

* one-sentence positioning
* three core platform principles
* one minimal workflow example
* explicit navigation paths
* conceptual framing before commands

The root page should NOT include:

* exhaustive CLI examples
* giant feature grids
* every docs link
* implementation trivia

---

## Core Principles To Surface

Flux should consistently present:

* PostgreSQL-first architecture
* migration-first workflow
* coherent isolation model
* JWT + RLS integration
* no-shim philosophy

---

# /introduction

## Purpose

The Introduction section establishes:

* identity
* philosophy
* mental model

before practical usage begins.

---

## Reader State

```txt
confused → curious → impressed
```

---

# /introduction/what-is-flux

## Primary Question

> What category of system is Flux?

---

## Responsibilities

This page should:

* define Flux plainly
* explain the role of PostgreSQL
* explain the role of REST APIs
* establish Flux as infrastructure orchestration
* avoid deep architecture details initially

---

## Must Avoid

* implementation deep dives
* benchmark claims
* competitor comparisons
* feature dumping

---

# /introduction/why-flux

## Primary Question

> Why does Flux exist?

---

## Responsibilities

This page explains:

* the migration-first philosophy
* SQL as source of truth
* no-shim philosophy
* predictable infrastructure
* transparent architecture
* deliberate simplicity

---

## Tone

This page should feel calm and opinionated.

It should NOT feel defensive or reactive.

---

# /introduction/mental-model

## Primary Question

> What are the moving parts?

---

## Responsibilities

This is one of the most important pages in the documentation system.

It should explain:

* application requests
* JWT flow
* gateway role
* PostgREST role
* PostgreSQL role
* RLS role
* pooled vs dedicated at a high level

This page should introduce diagrams early.

---

## Reader Outcome

After reading this page, the reader should be able to explain:

```txt
App
→ Flux Gateway
→ PostgREST
→ PostgreSQL
```

in plain language.

---

# /getting-started

## Purpose

The Getting Started section gets the reader to a successful working project quickly.

---

## Reader State

```txt
curious → building
```

---

## Principles

This section should:

* be linear
* be practical
* be copy-pasteable
* reinforce the mental model
* avoid excessive branching

---

# /getting-started/installation

## Primary Question

> Can I run Flux locally?

---

## Responsibilities

* install CLI
* verify environment
* explain minimal prerequisites

Keep this page short.

---

# /getting-started/create-project

## Primary Question

> What does a Flux project look like?

---

## Responsibilities

Explain:

* project creation
* service URL
* project identity
* basic provisioning flow

This page should reinforce what a "project" means conceptually.

---

# /getting-started/first-request

## Primary Question

> Does the platform behave the way the docs described?

---

## Responsibilities

This page closes the loop between:

* mental model
* API requests
* project provisioning
* authentication expectations

This page is psychologically important.

It validates the system.

---

# /getting-started/auth

## Primary Question

> How does authentication work?

---

## Responsibilities

Explain:

* JWT expectations
* external auth providers
* project JWT secret usage
* authenticated requests
* RLS implications

This page introduces trust boundaries lightly before deeper architecture pages.

---

# /concepts

## Purpose

The Concepts section defines durable platform ideas.

Concept pages answer:

> What is this?
> Why does it matter?

not:

> What flags exist?

---

## Reader State

```txt
curious → impressed → trusting
```

---

# /concepts/projects

Define:

* project identity
* deployable backend unit
* relationship to database/API
* infrastructure assignment

---

# /concepts/migrations

Define:

* migration-first workflow
* SQL as source of truth
* transactional execution
* schema evolution

---

# /concepts/jwt-auth

Define:

* external JWTs
* verification boundaries
* project secrets
* request identity

---

# /concepts/rls

Define:

* PostgreSQL RLS
* row ownership
* auth.uid() relationship
* responsibility boundaries

---

# /concepts/pooled-vs-dedicated

Define:

* operational differences
* isolation differences
* resource differences
* tradeoffs honestly

Avoid tier-marketing language here.

---

# /concepts/service-urls

Define:

* canonical API URL structure
* flattened URL model
* public request surface
* routing expectations

---

# /architecture

## Purpose

The Architecture section explains how Flux internally achieves its guarantees.

Architecture pages explain:

* trust boundaries
* infrastructure topology
* request lifecycle
* isolation behavior

---

## Reader State

```txt
impressed → trusting
```

---

# /architecture/flux-v2

Explain:

* shared infrastructure
* tenant schemas
* gateway orchestration
* pooled infrastructure design

---

# /architecture/gateway

Explain:

* request boundary
* project verification
* routing
* authentication behavior
* bridge JWT minting

---

# /architecture/bridge-jwts

Explain:

* external vs internal JWTs
* trust boundaries
* short-lived token model
* PostgREST expectations

---

# /architecture/tenant-isolation

Explain:

* schema isolation
* role isolation
* JWT separation
* project boundaries
* network boundaries where relevant

---

# /architecture/request-flow

Walk one request through the system step-by-step.

This page should strongly reinforce the mental model.

---

# /security

## Purpose

The Security section exists to centralize trust explanations.

Users expect security to have a dedicated home.

---

## Reader State

```txt
trusting
```

---

# /security/authentication-model

Explain:

* external auth providers
* JWT signing
* verification flow
* trust chain

---

# /security/tenant-isolation

Explain:

* shared vs isolated infrastructure
* boundaries
* schema protections
* project-level separation

---

# /security/rls-boundaries

Explain:

* what RLS guarantees
* what RLS does not guarantee
* developer responsibilities

---

# /security/project-secrets

Explain:

* per-project JWT secrets
* secret rotation
* secret ownership
* internal vs external trust

---

# /security/threat-model

Explain:

* intended boundaries
* non-goals
* assumptions
* operational expectations

This page should avoid fear-based writing.

---

# /guides

## Purpose

Guides solve real implementation problems.

They assume the reader understands the mental model already.

---

## Reader State

```txt
building
```

---

## Rules

Guides should:

* solve one problem well
* avoid re-explaining all architecture
* link to concepts/architecture pages
* use realistic examples

---

# /guides/authjs

Explain:

* Auth.js JWT minting
* jose usage
* Flux JWT claims
* RLS integration

---

# /guides/nextjs

Explain:

* Next.js App Router integration
* client/server request flow
* environment setup

---

# /guides/clerk

Explain:

* Clerk-issued JWTs
* Flux compatibility
* external issuer expectations

---

# /guides/migrations

Explain:

* migration workflow
* push strategy
* common pitfalls
* production safety

---

# /guides/v1-dedicated-sql-workflows

Explain:

* v1 dedicated only: `flux push` vs ad-hoc `psql` from `flux project credentials`
* slug/hash confirmation via `flux list`
* when to prefer tracked SQL files
* backup + `flux backup verify` before destructive SQL; artifact vs restore verification (short)

---

# /guides/v2-to-v1-migrate

Explain:

* difference between SQL migrations (`flux push`) and engine migration (`flux migrate`)
* control plane API vs tenant Service URL
* phased flow: dry-run, dump-only, staged, full cutover
* prerequisites: CLI auth, `flux.json`, `pg_dump` on control plane host
* post-migrate app env and JWT rotation

---

# /guides/production-hardening

Explain:

* operational recommendations
* backups
* secrets
* migration safety
* deployment considerations

---

# /examples

## Purpose

Examples prove coherence through realistic systems.

Examples should feel believable.

---

## Reader State

```txt
impressed → building
```

---

# /examples/bloom-atelier

Purpose:

Show a complete real-world Flux application.

Should demonstrate:

* auth
* migrations
* RLS
* API usage
* image handling
* multi-user behavior

---

# /examples/simple-crud

Purpose:

Show the smallest meaningful vertical slice.

This should be intentionally simple.

---

# /examples/multi-tenant-app

Purpose:

Demonstrate:

* tenant-aware application design
* JWT claims
* RLS ownership
* project-aware architecture

---

# /reference

## Purpose

Reference exists for returning builders.

It is not the primary onboarding path.

---

## Reader State

```txt
building
```

---

# /reference/cli

Complete CLI command and flag reference.

---

# /reference/env-vars

Environment variable lookup.

---

# /reference/config

Configuration structure reference.

---

# /reference/troubleshooting

Canonical home for reader-observable error symptoms across both engines.

Organize **by symptom**, not by subsystem:

* what the reader sees
* which layer of Flux usually caused it
* how to verify
* the common fix
* related pages

A reader looking up `42501` is already stuck. The page must answer "what does it mean, who owns the fix, what is the next click" without scrolling. Each entry should also state engine scope (`v2_shared`, `v1_dedicated`, both) so silently mismatched advice does not mislead.

Other pages may carry **brief** "Common errors" callouts (three rows or fewer) that link into the canonical entry here. They must not duplicate the cause/resolution prose.

---

# Documentation Ordering Rules

## Rules

### Concepts before mechanics

Explain systems before flags.

---

### Architecture has a dedicated home

Do not bury trust explanations inside guides.

---

### Reference is last

Reference supports memory.
It does not create understanding.

---

### Diagrams support teaching

Diagrams exist to reduce cognitive load, not decorate pages.

---

### Avoid duplication

Every concept should have one canonical explanation page.

Guides may summarize but should link back.

---

### Honest tradeoffs build trust

Do not flatten pooled and dedicated into marketing language.

Explain differences clearly.

---

### Commands reinforce understanding

Commands should validate the mental model, not replace it.

---

# Anti-Patterns To Avoid

Do NOT:

* lead onboarding with CLI tables
* flatten all docs into one long scroll
* duplicate architecture across every guide
* use examples as the only explanation of isolation
* use generic SaaS marketing language
* describe Flux as magic
* hide PostgreSQL
* hide RLS responsibilities
* imply Flux replaces database understanding

---

# Legacy Documentation Policy

Legacy documentation should be archived for internal reference only.

Do not allow old structure or wording to silently shape the new system.

Preserve:

* historical implementation notes
* old dashboard docs
* codex references where structurally useful

Rewrite:

* onboarding
* architecture explanation
* terminology
* conceptual sequencing

---

# Completion Criteria

The Information Architecture phase is complete when:

* every documentation route has a clear purpose
* emotional progression is intentional
* concepts and architecture are separated cleanly
* reference material is not the onboarding path
* trust explanations have a canonical home
* terminology is stable
* docs ordering feels coherent
* new contributors can understand where pages belong
