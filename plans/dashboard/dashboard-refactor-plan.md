# Flux Dashboard: Refactor Plan

## Status

Planned (ready for execution)

---

## Objective

Refactor the existing dashboard UI into the new structured system without:

- breaking functionality
- introducing regressions
- losing existing capabilities

This is an **incremental migration**, not a rewrite.

---

## Core Strategy

```txt
Refactor in layers, not all at once.
```

Each step must:

- leave the app in a working state
- be commit-safe
- be reversible

---

## Current State Summary

The dashboard currently:

```txt
renders repeated system panels
exposes internal terminology
lacks clear hierarchy
duplicates information
```

---

## Target State

The dashboard should:

```txt
center around the project
prioritize API + status
hide system complexity
use human-readable language
```

---

## Phase 1 — Copy + naming cleanup

### Goal

Replace system language with user-facing language.

---

### Changes

Replace labels:

```txt
CONNECTION_MANIFEST → Connection
MESH_TELEMETRY → Status
LOG_TAP → Logs
APP_ENV → Environment
POSTGREST API → API URL
```

---

### Scope

- text labels only
- no layout changes yet

---

### Result

```txt
UI feels lighter immediately
no visual breakage
```

---

### Commit

```txt
refactor: normalize dashboard language to user-facing terms
```

---

## Phase 2 — Remove duplicate panels

### Goal

Eliminate repeated blocks and redundant UI.

---

### Actions

- identify duplicated `Connection` / `Env` panels
- remove extra instances
- ensure each concept appears only once

---

### Result

```txt
reduced visual noise
clearer structure
```

---

### Commit

```txt
refactor: remove duplicate dashboard panels
```

---

## Phase 3 — Introduce project header

### Goal

Create a clear top-level identity for each project.

---

### Add

```tsx
<ProjectHeader>
  ProjectName
  StatusIndicator
  PrimaryActions
</ProjectHeader>
```

---

### Move

- project name → header
- status → header
- main actions → header

---

### Result

```txt
clear entry point
strong visual hierarchy
```

---

### Commit

```txt
feat: introduce project header with status and actions
```

---

## Phase 4 — Extract API panel

### Goal

Make API URL the primary element.

---

### Create

```tsx
<ApiPanel />
```

---

### Move into panel

- API URL
- copy button

---

### Remove noise

- extra labels
- redundant descriptions

---

### Result

```txt
user finds API instantly
```

---

### Commit

```txt
feat: extract API panel as primary project element
```

---

## Phase 5 — Introduce actions bar

### Goal

Centralize all actions.

---

### Create

```tsx
<ActionsBar>
  Open Console
  View Logs
  Run Migration
</ActionsBar>
```

---

### Remove

- scattered buttons
- duplicate actions

---

### Result

```txt
actions become predictable
```

---

### Commit

```txt
feat: consolidate project actions into actions bar
```

---

## Phase 6 — Reorganize secondary sections

### Goal

Structure non-primary information.

---

### Create sections

```txt
Environment
Database
CLI
Logs
```

---

### Rules

- each section appears once
- no stacked system blocks
- no long explanations

---

### Result

```txt
clean vertical flow
```

---

### Commit

```txt
refactor: organize secondary panels into structured sections
```

---

## Phase 7 — Collapse advanced / debug info

### Goal

Hide system complexity by default.

---

### Create

```tsx
<AdvancedPanel collapsed>
  debug info
  internal state
</AdvancedPanel>
```

---

### Move into advanced

- logs (optional)
- system details
- internal notes

---

### Result

```txt
default UI becomes simple
power users still supported
```

---

### Commit

```txt
feat: introduce collapsible advanced panel
```

---

## Phase 8 — Remove telemetry noise

### Goal

Eliminate meaningless visuals.

---

### Remove

```txt
mesh telemetry bars
low-signal metrics
decorative system indicators
```

---

### Keep only

```txt
status (online/offline)
```

---

### Result

```txt
visual calm
less distraction
```

---

### Commit

```txt
refactor: remove telemetry visuals from default dashboard view
```

---

## Phase 9 — Spacing + layout pass

### Goal

Align with visual design doc.

---

### Apply

```txt
consistent section spacing
clear hierarchy
no dense stacking
```

---

### Result

```txt
dashboard feels intentional
not crowded
```

---

### Commit

```txt
style: apply spacing and layout improvements
```

---

## Implementation rules

### DO

```txt
refactor incrementally
commit after each phase
test UI after each change
```

---

### DO NOT

```txt
rewrite everything at once
change copy during layout phases
introduce new features mid-refactor
```

---

## Validation checklist

After refactor:

- user sees API immediately
- status is obvious
- actions are clear
- no duplicate panels exist
- no system jargon remains
- UI feels lighter

---

## Final principle

```txt
Refactor toward clarity, not complexity.
```

---

## Related

- [`dashboard-refactor-checklist.md`](dashboard-refactor-checklist.md) — step-by-step execution checklist
- [`dashboard-ux-principles.md`](dashboard-ux-principles.md) — goals and anti-goals
- [`dashboard-information-architecture.md`](dashboard-information-architecture.md) — information hierarchy
- [`dashboard-component-spec.md`](dashboard-component-spec.md) — target components and layout
- [`dashboard-copy-decisions.md`](dashboard-copy-decisions.md) — canonical labels (Phase 1)
- [`dashboard-visual-redesign-pass.md`](dashboard-visual-redesign-pass.md) — keep / remove / simplify / restructure
- [`dashboard-visual-design.md`](dashboard-visual-design.md) — visual system (Phase 9 and ongoing)
