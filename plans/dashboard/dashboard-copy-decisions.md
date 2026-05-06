# Flux Dashboard: Copy Decisions

## Status

Accepted (v0 dashboard language)

---

## Objective

Define the language used across the Flux dashboard.

This document exists to:

- replace internal/system terminology
- align dashboard tone with landing page
- reduce cognitive load for users
- standardize naming across components

---

## Core Principle

```txt
Use language the user would use, not the system.
```

---

## Tone

Dashboard tone should be:

```txt
calm
direct
minimal
developer-focused
```

---

## Avoid

```txt
infrastructure jargon
internal system naming
debug-level terminology
long explanations
```

---

## Naming Replacements

### System → User Language

| Current              | Replace With | Why                                |
| -------------------- | ------------ | ---------------------------------- |
| CONNECTION_MANIFEST  | Connection   | Simpler, obvious                   |
| MESH_TELEMETRY       | Status       | User cares about state, not system |
| LOG_TAP              | Logs         | Standard, expected                 |
| APP_ENV              | Environment  | Familiar term                      |
| POSTGREST API        | API URL      | Action-oriented                    |
| STACK ACTIVE_RUNNING | Online       | Human-readable                     |
| OPERATIONAL          | Running      | Simpler                            |

---

## Status Language

### Final Set

```txt
Online
Offline
Starting
Error
```

---

### Do NOT use

```txt
OPERATIONAL
ACTIVE_RUNNING
HEALTHY_STATE
```

---

## API Section

### Final Label

```txt
API URL
```

---

### Supporting Copy (minimal)

```txt
Use this in your app.
```

(optional — can be omitted)

---

### Buttons

```txt
Copy
```

Avoid:

```txt
COPY_ENV
COPY_URL
```

---

## Environment Section

### Final Label

```txt
Environment
```

---

### Rules

- no long explanations
- no instructional blocks by default
- collapse if large

---

## CLI Snippet

### Final Label

```txt
CLI
```

---

### Optional Helper Text

```txt
Run from your terminal.
```

---

### Example

```txt
flux push ./migrations/schema.sql
```

---

### Rules

- keep short
- do not explain flags inline
- do not overwhelm with variations

---

## Database Tools

### Final Label

```txt
Database
```

---

### Button

```txt
Open database tools
```

---

## Logs Section

### Final Label

```txt
Logs
```

---

### Empty State

```txt
No logs available.
```

---

## Buttons

### Primary Actions

```txt
Open Console
Settings
```

---

### Secondary Actions

```txt
View Logs
Run Migration
```

---

### Avoid

```txt
OPEN_CONSOLE (all caps)
REPAIR
STOP (unless critical)
```

---

## Empty States

### General Rule

```txt
short
neutral
no instructions
```

---

### Examples

```txt
No data yet.
Nothing to show.
```

---

## Error Messages

### Tone

```txt
clear
brief
non-alarmist
```

---

### Example

```txt
Could not connect to project.
```

Avoid:

```txt
Connection failure due to upstream resolution issue...
```

---

## Tooltips

### Rule

Only use when necessary.

---

### Tone

```txt
short
clarifying
non-technical
```

---

## Section Headers

### Style

```txt
simple
single word when possible
```

---

### Examples

```txt
Status
API
Environment
Database
Logs
```

---

## What to Remove

Remove or hide by default:

```txt
long inline documentation
system explanations
internal notes
debug context
```

---

## Final Check

Each label should pass:

```txt
Would a developer instantly understand this?
```

If not → simplify.

---

## Final Principle

```txt
The dashboard should feel obvious, not technical.
```

---

## Related

- [`dashboard-ux-principles.md`](dashboard-ux-principles.md) — how the dashboard should feel and behave
- [`dashboard-information-architecture.md`](dashboard-information-architecture.md) — section order, hierarchy, and structure
- [`dashboard-component-spec.md`](dashboard-component-spec.md) — component tree and layout rules
- [`dashboard-refactor-plan.md`](dashboard-refactor-plan.md) — phased execution plan (starts with this doc in Phase 1)
- [`dashboard-refactor-checklist.md`](dashboard-refactor-checklist.md) — step-by-step checklist
- [`dashboard-visual-redesign-pass.md`](dashboard-visual-redesign-pass.md) — visual diff against current UI
- [`dashboard-visual-design.md`](dashboard-visual-design.md) — visual system (aligned with landing)
