# Flux Dashboard: Visual Design

## Status

Accepted (v0 aesthetic alignment with landing page)

---

## Objective

Define the visual language of the Flux dashboard.

The dashboard must visually align with the landing page:

```txt
calm
minimal
editorial
developer-first
```

---

## Core Principle

```txt
The dashboard should feel like a continuation of the landing page.
```

Not:

```txt
a separate tool
a dev console
a debug interface
```

---

## Design mood

Flux dashboard should feel:

```txt
quiet
intentional
practical
trustworthy
```

---

## Avoid

```txt
loud gradients
neon highlights
heavy borders
dashboard clutter
visual noise
```

---

## Color system

### Base palette

Use neutral tones:

```txt
background:        white or near-white
text-primary:      neutral-900
text-secondary:    neutral-600
text-muted:        neutral-400
border:            neutral-200
```

---

### Accent usage

Use sparingly:

```txt
green → status (online)
red → error only
blue → optional interactive highlight
```

---

### Rules

```txt
color should guide, not decorate
```

---

## Typography (shared with landing)

### Font pairing

```txt
Headlines: IBM Plex Serif
Body/UI:   IBM Plex Sans
Code:      IBM Plex Mono
```

---

### Usage

#### Project name

```txt
serif
larger
primary identity
```

---

#### UI text

```txt
sans
clean
neutral
```

---

#### CLI / code

```txt
mono
small
subtle
```

---

### Rule

```txt
Do not overuse serif.
```

---

## Layout philosophy

### Structure

```txt
clear sections
vertical flow
breathing room
```

---

### Container

```txt
max-width: 900–1100px
centered
```

---

### Spacing

Use generous spacing:

```txt
large gaps between sections
no dense stacking
```

---

### Rule

```txt
Whitespace is the primary layout tool.
```

---

## Component styling

### 1. Project header

#### Style

```txt
minimal
no heavy borders
light separation only
```

---

### 2. API panel

#### Style

```txt
largest visual element
clear spacing
no surrounding clutter
```

---

### 3. Buttons

#### Style

```txt
simple
rounded
neutral background
no gradients
```

---

#### Primary button

```txt
dark background (black/neutral-900)
white text
```

---

#### Secondary buttons

```txt
light background
neutral border
```

---

### 4. CLI block

#### Style

```txt
light background (neutral-100)
rounded corners
small padding
mono font
```

---

#### Avoid

```txt
large dark terminal blocks
heavy shadows
overly styled code panels
```

---

### 5. Sections

#### Style

```txt
separated by spacing, not borders
```

---

#### Avoid

```txt
boxed cards everywhere
thick borders
panel stacking
```

---

## Visual hierarchy

Priority order:

```txt
1. Project Name
2. API URL
3. Status
4. Actions
5. Everything else
```

---

### Rule

```txt
If everything stands out, nothing stands out.
```

---

## Interaction design

### Buttons

```txt
clear
predictable
minimal
```

---

### Hover states

```txt
subtle
no dramatic transitions
```

---

### Transitions

```txt
fast
almost unnoticeable
```

---

## Density control

### Default view

```txt
simple
essential
lightweight
```

---

### Advanced view

```txt
collapsed
optional
user-triggered
```

---

## Alignment rules

### Landing vs dashboard

| Element   | Landing  | Dashboard    |
| --------- | -------- | ------------ |
| Alignment | Centered | Left-aligned |
| Density   | Very low | Moderate     |
| Focus     | Message  | Usage        |

---

### Rule

```txt
Landing = invite
Dashboard = operate
```

---

## Before vs after

### Before

```txt
busy
system-heavy
panel-stacked
debug-oriented
```

---

### After

```txt
calm
structured
intentional
product-focused
```

---

## Validation checklist

The dashboard is correct if:

```txt
API is instantly visible
layout feels calm
nothing feels “debuggy”
user does not feel overwhelmed
visual style matches landing
```

---

## Final principle

```txt
Design should disappear.
The user should focus on their project, not the interface.
```

---

## Related

- [`../marketing/landing-page-visual-design.md`](../marketing/landing-page-visual-design.md) — shared typography and calm tone (landing)
- [`dashboard-ux-principles.md`](dashboard-ux-principles.md) — behavior and mental model
- [`dashboard-component-spec.md`](dashboard-component-spec.md) — component structure
- [`dashboard-visual-redesign-pass.md`](dashboard-visual-redesign-pass.md) — diff vs current UI
- [`dashboard-refactor-plan.md`](dashboard-refactor-plan.md) — execution order
- [`dashboard-refactor-checklist.md`](dashboard-refactor-checklist.md) — step-by-step checklist
