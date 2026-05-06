# Flux Landing Page: Copy Decisions

## Status

Accepted (v0 public-facing copy)

---

## Objective

Define the exact copy used on the Flux landing page.

This document exists to:

- prevent copy drift
- keep tone consistent
- give Cursor a fixed reference
- avoid “creative rewrites” during implementation

---

## Core Principle

```txt
Simple beats clever.
Clear beats expressive.
Believable beats absolute.
```

---

## Hero

### Final Copy

```txt
PostgreSQL, ready to use.

A clean API over your database.
No setup.

[ Get started ]
```

---

### Why

The hero must:

- be understood in under 5 seconds
- feel calm and confident
- avoid marketing language

---

### Explicit Decisions

Removed:

```txt
No abstraction
Your database is ready from day one
```

Reason:

- “No abstraction” → too technical / defensive
- “from day one” → reads like marketing copy

---

## Bullets

### Final Copy

```txt
Start instantly
Clean API
Scales as you grow
```

---

### Why

- consistent structure
- human phrasing
- aligned with lifecycle messaging

---

### Explicit Decisions

Replaced:

```txt
No setup
```

With:

```txt
Start instantly
```

Reason:

- “No setup” feels unrealistic / absolute
- “Start instantly” feels believable and actionable

---

## CLI Section

### Final Copy

```txt
Get started from your terminal.

$ curl -sL https://flux.vsl-base.com/install | bash
$ flux create my-app
```

---

### Why

- shows real usage
- reinforces simplicity
- bridges idea → action

---

### Explicit Decisions

Do NOT include:

```txt
flux login
flux push schema.sql
```

Reason:

- login introduces friction
- extra commands reduce perceived simplicity
- landing page shows the “happy path,” not full workflow

---

## Lifecycle Section

### Final Copy

```txt
Start with a free project.

When your app grows, move to a dedicated instance.
No neighbors. No changes.
```

---

### Why

- introduces differentiation without complexity
- avoids technical terms (pooled, dedicated, etc.)
- reinforces long-term trust

---

### Explicit Decisions

Replaced:

```txt
No rewrites
```

With:

```txt
No changes
```

Reason:

- more intuitive
- less technical
- easier to understand immediately

---

## Bottom CTA

### Final Copy

```txt
Start building on PostgreSQL
```

---

### Why

- specific to developer intent
- reflects real user motivation
- stronger than generic CTA

---

## CTA Button Label

### Final Copy

```txt
Get started
```

---

### Why

- familiar
- low friction
- expected behavior

---

## Tone Rules

All landing page copy must follow:

```txt
short sentences
plain language
no hype
no over-explanation
```

---

## What to Avoid

Do NOT introduce:

```txt
multi-tenant
schema isolation
JWT
pooled vs dedicated
architecture explanations
```

These belong in docs, not landing.

---

## Final Check

Every line should pass:

```txt
Would a developer understand this instantly?
Does this feel believable?
Would I try this?
```

If not → simplify further.
