Perfect — this is where the tone turns into something concrete and buildable.

This document should feel like a **blueprint Cursor (or you) can implement directly**, not just ideas.

---

````md
# Flux Landing Page: Redesign Plan

## Status
Planned (aligned with tone & positioning v0)

---

## Objective

Translate the tone and positioning into a concrete landing page structure.

The goal is:

> A minimal, clear page that gets a developer to try Flux.

Not to explain everything.

---

## Core Principles

From tone document:

```txt
- Simple
- Minimal
- Low jargon
- Fast to understand (≤ 5 seconds)
````

---

## Page Structure (Top → Bottom)

---

## 1. Hero Section

### Purpose

Immediately communicate what Flux is.

### Layout

```txt
[Headline]

[Subtext]

[Primary CTA]

(optional small visual or diagram)
```

---

### Copy (v1)

```txt
Headline:
PostgreSQL, ready to use.

Subtext:
A clean API over your database.
No setup. No abstraction.

CTA:
Get started
```

Alternative headline options:

```txt
Build on PostgreSQL.
Flux handles the setup.

Use PostgreSQL without the hassle.
```

---

### Notes

* No mention of pooled/dedicated
* No mention of architecture
* No long paragraphs
* No feature list here

---

## 2. Mental Model (Optional but Recommended)

### Purpose

Help user “see” what Flux does without reading docs

### Layout

```txt
Your App → Flux → PostgreSQL
```

### Implementation ideas

* simple diagram
* 3 columns
* minimal labels

### Copy

```txt
Your app talks to Flux.
Flux talks to PostgreSQL.
```

---

## 3. “Why Flux” (3 bullets max)

### Purpose

Reinforce simplicity + clarity

### Layout

```txt
• No setup
• Clean API
• Upgrade when your app grows
```

Alternative:

```txt
• Start instantly
• No hidden layers
• Scales when you need it
```

---

### Notes

* Max 3 bullets
* No paragraphs
* Avoid tech jargon

---

## 4. Lifecycle Section (Differentiator)

### Purpose

Introduce your real advantage without overwhelming

### Layout

Short paragraph or two lines

---

### Copy

```txt
Start with a free project.

When your app grows, move to a dedicated instance.
No neighbors. No rewrites.
```

Alternative:

```txt
Start simple.
Upgrade when you need it.
Your API stays the same.
```

---

### Notes

This is where your original “pooled → dedicated” idea lives — but simplified.

---

## 5. Call to Action (Reinforced)

### Purpose

Convert interest → action

---

### Copy

```txt
Start building on PostgreSQL today.

[ Get started ]
```

---

## 6. Optional Secondary Sections (Later, not v1)

These should NOT block initial launch:

* Example API usage
* Framework integrations (Next.js, etc.)
* Light comparison (Supabase-style)
* Testimonials (future)

---

## What to Remove from Current Page

Aggressively cut:

```txt
- architecture explanations
- pooled vs dedicated explanations
- deep technical descriptions
- long paragraphs
- feature overload
```

---

## Visual Design Direction

### Style

```txt
- editorial
- calm
- neutral
- restrained
```

### Avoid

```txt
- loud gradients
- heavy SaaS visuals
- busy UI screenshots
```

### Prefer

```txt
- whitespace
- typography
- subtle structure
```

---

## Content Density Rules

For every section:

```txt
If it feels like “a lot to read” → cut it.
```

Target:

```txt
Scanable in < 10 seconds
```

---

## Mobile Consideration

Must work vertically:

```txt
Headline
Subtext
CTA
↓
Diagram
↓
3 bullets
↓
Lifecycle
↓
CTA
```

No wide/complex layouts required.

---

## Implementation Notes (Next.js / Tailwind)

* Use centered layout
* Max width ~640–720px for readability
* Generous spacing (py-16 / py-24)
* Font hierarchy:

  * H1 large, bold
  * Subtext muted
  * Bullets simple

---

## Acceptance Criteria

Landing page is successful if:

* A developer understands it in 5 seconds
* It feels simple, not technical
* It does not overwhelm
* It clearly encourages trying Flux
* It avoids explaining internal architecture

---

## Final Reminder

```txt
Landing page = clarity + confidence

Docs = depth
Dashboard = usability
```

Do not mix them.

```

---

This gives you:

- a **buildable plan**
- a **clear scope (v1 vs later)**
- and something Cursor can actually execute cleanly

