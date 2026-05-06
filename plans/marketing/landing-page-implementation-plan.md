# Flux Landing Page: Implementation Plan

## Status

Planned (ready for implementation)

---

## Objective

Translate the approved copy and visual design into a concrete implementation.

This document defines:

- exact sections to render
- structure and order
- component responsibilities
- constraints for implementation

This is NOT a design exploration document.

This is a build specification.

---

## Source of Truth

Implementation must follow:

- [`landing-page-copy-decisions.md`](landing-page-copy-decisions.md)
- [`landing-page-visual-design.md`](landing-page-visual-design.md)

Do NOT:

- invent new copy
- add sections
- rephrase messaging

---

## Page Structure (Strict)

```txt
Hero
↓
Bullets
↓
CLI section
↓
Lifecycle
↓
Final CTA
```

No additional sections in v0.

---

## Component Breakdown

Recommended structure (Next.js App Router):

```txt
app/
  (marketing)/
    page.tsx
    components/
      Hero.tsx
      Bullets.tsx
      CliSnippet.tsx
      Lifecycle.tsx
      FinalCTA.tsx
```

---

## 1. Hero Component

### Content

```txt
PostgreSQL, ready to use.

A clean API over your database.
No setup.

[ Get started ]
```

---

### Requirements

- centered layout
- serif headline
- sans body text
- single CTA button

---

### Structure

```tsx
<section>
  <h1 />
  <p />
  <button />
</section>
```

---

## 2. Bullets Component

### Content

```txt
Start instantly
Clean API
Scales as you grow
```

---

### Requirements

- vertical stack
- centered
- no icons
- even spacing

---

### Structure

```tsx
<section>
  <ul>
    <li />
    <li />
    <li />
  </ul>
</section>
```

---

## 3. CLI Snippet Component

### Content

```txt
Get started from your terminal.

$ curl -sL https://flux.vsl-base.com/install | bash
$ flux create my-app
```

---

### Requirements

- mono font for commands
- subtle background
- small visual footprint
- centered

---

### Structure

```tsx
<section>
  <p />
  <pre>
    <code />
  </pre>
</section>
```

---

### Explicit Constraints

Do NOT:

- include `flux login`
- include additional commands
- explain commands

---

## 4. Lifecycle Component

### Content

```txt
Start with a free project.

When your app grows, move to a dedicated instance.
No neighbors. No changes.
```

---

### Requirements

- short paragraphs
- centered
- no technical language

---

### Structure

```tsx
<section>
  <p />
  <p />
</section>
```

---

## 5. Final CTA Component

### Content

```txt
Start building on PostgreSQL

[ Get started ]
```

---

### Requirements

- slightly more spacing than other sections
- centered
- clear visual end to page

---

### Structure

```tsx
<section>
  <p />
  <button />
</section>
```

---

## Layout Rules

### Container

```txt
max-width: ~640–720px
centered
horizontal padding
```

---

### Section Spacing

Use consistent vertical rhythm:

```txt
large spacing between sections
clear separation
no crowding
```

---

### Alignment

```txt
centered text
centered elements
```

---

## Typography Application

Follow visual design doc:

```txt
Hero → serif
Body → sans
CLI → mono
```

---

## Styling Constraints

Do NOT add:

```txt
animations
icons
cards
multi-column layouts
complex visuals
```

---

## Interactivity

Only required interaction:

```txt
CTA button(s)
```

No additional behavior required in v0.

---

## Responsiveness

Mobile-first layout:

```txt
single column
stacked sections
readable spacing
```

No complex responsive logic required.

---

## Acceptance Criteria

Implementation is complete when:

- page matches copy exactly
- only defined sections exist
- layout is centered and minimal
- no extra UI elements are introduced
- typography follows defined pairing
- page is readable and calm

---

## Anti-Goals

Do NOT:

- improve copy
- add sections
- “enhance” UI
- introduce new ideas
- make it “more impressive”

---

## Final Principle

```txt
Implement exactly what is written.
Nothing more.
```
