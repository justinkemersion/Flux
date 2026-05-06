# Flux Dashboard: Information Architecture

## Status

Planned (v0 structure)

---

## Objective

Define how information is organized in the dashboard.

---

## Current Issues

- stacked panels with equal visual weight
- unclear hierarchy
- system-first naming
- duplicated content

---

## Proposed Structure

Each project should be structured as:

```txt
Project
├── Status
├── API
├── Usage (optional)
├── Actions
└── Advanced (collapsed)
```

---

## 1. Project Card (Main View)

### Content

```txt
Project Name
Status (online / offline)
API URL (copy)
Primary actions
```

---

### Example

```txt
yeastcoast

● Online

https://api--yeastcoast--ffca33f.vsl-base.com  [Copy]

[ Open Console ]   [ Settings ]
```

---

## 2. Project Detail View

---

### Section 1 — Status

```txt
Online
Operational
```

Minimal.

Remove telemetry bars unless meaningful.

---

### Section 2 — API

```txt
Service URL
Environment variables
Copy buttons
```

Simplify:

- remove noise
- group logically

---

### Section 3 — Actions

```txt
Open Console
Run Migration
View Logs
```

---

### Section 4 — Database Tools

Keep:

```txt
Open Database Tools
```

But reduce surrounding noise.

---

### Section 5 — Advanced (collapsed)

Contains:

```txt
logs
internal info
debug data
```

Only shown when user expands.

---

## Naming Changes

Replace system language:

```txt
CONNECTION_MANIFEST → Connection
APP_ENV → Environment
MESH_TELEMETRY → Status
LOG_TAP → Logs
```

---

## Removal / Reduction

Reduce or remove:

- duplicate panels
- repeated headers
- long explanatory blocks

---

## CLI Snippet Placement

Keep CLI snippet, but:

```txt
move to secondary position
make it subtle
```

---

## Visual Hierarchy

```txt
Project name → largest
Status → small indicator
API URL → primary actionable element
Everything else → secondary
```

---

## Layout

Avoid:

```txt
stacked dense panels
```

Prefer:

```txt
clear sections
breathing room
```

---

## Final Goal

The user should:

```txt
understand their project in seconds
find the API instantly
take action without thinking
```

---

## Related

- [`dashboard-ux-principles.md`](dashboard-ux-principles.md) — UX principles and anti-goals
- [`dashboard-component-spec.md`](dashboard-component-spec.md) — concrete components and layout
- [`dashboard-copy-decisions.md`](dashboard-copy-decisions.md) — canonical naming and dashboard copy
- [`dashboard-refactor-plan.md`](dashboard-refactor-plan.md) — phased execution plan
- [`dashboard-refactor-checklist.md`](dashboard-refactor-checklist.md) — step-by-step checklist
- [`dashboard-visual-redesign-pass.md`](dashboard-visual-redesign-pass.md) — visual diff against current UI
- [`dashboard-visual-design.md`](dashboard-visual-design.md) — visual system (aligned with landing)
