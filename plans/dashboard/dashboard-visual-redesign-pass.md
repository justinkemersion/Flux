# Flux Dashboard: Visual Redesign Pass

## Status

Planned (annotated review of current UI)

---

## Objective

Evaluate the current dashboard UI and define:

- what to keep
- what to remove
- what to simplify
- what to restructure

This is based on real screenshots of the current system.

---

## Core Principle

```txt
Keep what works.
Remove what explains the system.
Highlight what the user needs.
```

---

## High-level assessment

### Current feel

```txt
powerful
technical
system-oriented
debug-heavy
```

---

### Target feel

```txt
calm
clear
intentional
developer-focused
```

---

## KEEP (strong elements)

These are good and should remain.

---

### 1. Project cards (overview screen)

Keep:

```txt
project name
status indicator (green dot)
API URL with copy button
basic actions
```

---

#### Why

```txt
clear
useful
scannable
```

---

#### Adjustment

- reduce visual weight (less borders/glow)
- simplify buttons

---

### 2. API URL copy interaction

Keep:

```txt
click-to-copy behavior
inline URL display
```

---

#### Why

```txt
this is the primary user action
```

---

#### Adjustment

- make API more prominent
- reduce surrounding noise

---

### 3. CLI snippet concept

Keep:

```txt
CLI usage shown in UI
```

---

#### Why

```txt
bridges UI → real usage
```

---

#### Adjustment

```txt
make smaller
make secondary
reduce explanation text
```

---

## REMOVE (high priority)

These actively harm UX.

---

### 1. MESH_TELEMETRY bars

Remove completely:

```txt
green segmented bars
repeated telemetry blocks
```

---

#### Why

```txt
no clear meaning
visual noise
repeated across screen
```

---

### 2. CONNECTION_MANIFEST blocks

Remove current form.

---

#### Why

```txt
too dense
repeated
system-oriented
not user-friendly
```

---

#### Replace with

```txt
single API panel
```

---

### 3. LOG_TAP / POOLED sections

Remove from default view.

---

#### Why

```txt
debug-level information
irrelevant for most users
adds cognitive load
```

---

#### Replace with

```txt
Logs (collapsed section)
```

---

### 4. Repeated panels

Remove:

```txt
duplicate environment blocks
duplicate connection blocks
stacked repeated sections
```

---

#### Why

```txt
breaks hierarchy
confuses user
feels like raw system output
```

---

### 5. Long inline explanations

Remove:

```txt
multi-line comments
instruction blocks inside panels
technical notes
```

---

#### Why

```txt
belongs in docs, not UI
slows scanning
adds noise
```

---

## SIMPLIFY (transform, not remove)

---

### 1. Environment section

#### Current

- dense
- explanation-heavy
- visually heavy

---

#### Target

```txt
Environment

KEY=value        [Copy]
KEY=value        [Copy]
```

---

#### Rules

```txt
no explanations
clean list
optional collapse
```

---

### 2. CLI snippet

#### Current

- too verbose
- includes explanation text

---

#### Target

```txt
CLI

flux push ./migrations/schema.sql   [Copy]
```

---

#### Rules

```txt
short
one example
no explanation
```

---

### 3. Buttons

#### Current

```txt
OPEN_CONSOLE
REPAIR
STOP
```

---

#### Target

```txt
Open Console
Settings
View Logs
```

---

#### Rules

```txt
sentence case
human-readable
limited number
```

---

### 4. Status labels

#### Current

```txt
OPERATIONAL
STACK ACTIVE_RUNNING
```

---

#### Target

```txt
Online
```

---

#### Rules

```txt
single word
immediate understanding
```

---

## RESTRUCTURE (big wins)

---

### 1. Project detail layout

#### Current

```txt
stacked panels
equal visual weight
no clear entry point
```

---

#### Target

```txt
Header
↓
API (primary)
↓
Actions
↓
Secondary sections
↓
Advanced (collapsed)
```

---

### 2. Visual hierarchy

#### Current

```txt
everything looks equally important
```

---

#### Target

```txt
Project Name → strongest
API URL → primary action
Status → small indicator
Everything else → secondary
```

---

### 3. Section separation

#### Current

```txt
tight stacking
repeated borders
dense layout
```

---

#### Target

```txt
clear spacing
distinct sections
breathing room
```

---

## ADD (minimal, intentional)

---

### 1. Project header

Add:

```txt
project name
status
primary actions
```

---

#### Why

```txt
creates orientation
anchors the page
```

---

### 2. API panel

Add:

```txt
API URL (large)
copy button
```

---

#### Why

```txt
this is the main reason the user is here
```

---

### 3. Actions bar

Add:

```txt
Open Console
View Logs
Run Migration
```

---

#### Why

```txt
centralizes interaction
reduces duplication
```

---

### 4. Advanced panel (collapsed)

Add:

```txt
logs
debug info
internal data
```

---

#### Why

```txt
keeps power without clutter
```

---

## Before vs after (summary)

### Before

```txt
system-first
dense
repetitive
debug-oriented
```

---

### After

```txt
project-first
minimal
structured
usable
```

---

## Final validation

The redesign is successful if:

```txt
user finds API immediately
user understands status instantly
user can take action without thinking
no system jargon is visible
UI feels calm and intentional
```

---

## Final principle

```txt
Do not surface the system.

Surface what the user needs to build.
```

---

## Related

- [`dashboard-ux-principles.md`](dashboard-ux-principles.md) — principles this pass implements
- [`dashboard-information-architecture.md`](dashboard-information-architecture.md) — target information hierarchy
- [`dashboard-component-spec.md`](dashboard-component-spec.md) — target structure
- [`dashboard-copy-decisions.md`](dashboard-copy-decisions.md) — naming aligned with REMOVE / SIMPLIFY
- [`dashboard-refactor-plan.md`](dashboard-refactor-plan.md) — phased execution
- [`dashboard-refactor-checklist.md`](dashboard-refactor-checklist.md) — step-by-step checklist
- [`dashboard-visual-design.md`](dashboard-visual-design.md) — target aesthetic and tokens
