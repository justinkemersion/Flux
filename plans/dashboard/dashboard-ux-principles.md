# Flux Dashboard: UX Principles

## Status

Accepted (v0 UX direction)

---

## Objective

Define how the Flux dashboard should feel and behave.

The dashboard is not a control panel for infrastructure.

It is:

```txt
a workspace for developers using their database
```

---

## Core Principle

```txt
Show the project, not the system.
```

---

## Current Problem

The dashboard currently reflects:

```txt
internal system structure
debugging surfaces
infrastructure terminology
```

This results in:

- cognitive overload
- unclear hierarchy
- user confusion

---

## Target Experience

The dashboard should feel:

```txt
calm
clear
intentional
developer-focused
```

---

## User Mental Model

The user thinks:

```txt
I have a project.
It has an API.
It is running.
I want to use it.
```

NOT:

```txt
What is the mesh telemetry?
What is the connection manifest?
```

---

## Design Rules

### 1. One Primary Focus Per Screen

Each screen should answer:

```txt
What does the user need right now?
```

---

### 2. Reduce Visible System Concepts

Avoid exposing:

```txt
containers
clusters
internal services
debug-level terminology
```

Unless explicitly requested.

---

### 3. Progressive Disclosure

Default view:

```txt
simple
minimal
essential
```

Advanced view:

```txt
logs
internals
diagnostics
```

---

### 4. Rename for Humans

Replace:

```txt
CONNECTION_MANIFEST → Connection
MESH_TELEMETRY → Status
LOG_TAP → Logs
```

---

### 5. Eliminate Duplication

Do not show:

- repeated panels
- multiple sources of the same information

---

### 6. Prefer Actions Over Data

Instead of:

```txt
showing everything
```

Prefer:

```txt
clear actions
copy buttons
simple controls
```

---

### 7. Calm Visual Tone

Match landing page:

```txt
minimal
editorial
quiet
```

---

## Anti-Goals

Do NOT:

```txt
turn the dashboard into a DevOps console
surface all system internals by default
optimize for debugging over usability
```

---

## Final Principle

```txt
The system is complex.
The dashboard should not be.
```

---

## Related

- [`dashboard-information-architecture.md`](dashboard-information-architecture.md) — information hierarchy and screen structure
- [`dashboard-component-spec.md`](dashboard-component-spec.md) — components, hierarchy, and screen structure
- [`dashboard-copy-decisions.md`](dashboard-copy-decisions.md) — labels, tone, and user-facing language
- [`dashboard-refactor-plan.md`](dashboard-refactor-plan.md) — phased execution plan
- [`dashboard-refactor-checklist.md`](dashboard-refactor-checklist.md) — step-by-step checklist
- [`dashboard-visual-redesign-pass.md`](dashboard-visual-redesign-pass.md) — keep / remove / simplify / restructure
- [`dashboard-visual-design.md`](dashboard-visual-design.md) — visual system (aligned with landing)
