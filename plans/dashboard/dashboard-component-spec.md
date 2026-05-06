# Flux Dashboard: Component Specification

## Status

Planned (v0 structure)

---

## Objective

Define the exact UI structure of the dashboard.

This document replaces:

- ad hoc panels
- repeated system blocks
- debug-oriented layout

With:

```txt
clear hierarchy
minimal components
intentional structure
```

---

## Core Principle

```txt
One screen = one clear mental model.
```

---

## Page Types

```txt
1. Project List (overview)
2. Project Detail (primary workspace)
```

---

## 1. Project List View

### Purpose

Quickly answer:

```txt
What projects do I have?
Are they running?
What is their API?
```

---

### Component: ProjectCard

#### Structure

```tsx
<ProjectCard>
  <ProjectName />
  <StatusIndicator />
  <ApiUrl />
  <Actions />
</ProjectCard>
```

---

#### Layout

```txt
Grid (2–3 columns desktop, 1 column mobile)
```

---

#### Content

```txt
yeastcoast

● Online

https://api--yeastcoast--ffca33f.vsl-base.com  [Copy]

[ Open ]   [ Settings ]
```

---

#### Rules

- no telemetry bars
- no environment blocks
- no logs
- no duplication

---

#### Interaction

```txt
Click card → Project Detail
```

---

## 2. Project Detail View

### Purpose

Primary workspace for a single project.

Must answer:

```txt
Is it running?
What is the API?
What can I do?
```

---

### Layout Structure

```txt
Header
↓
Primary Section (API + Status)
↓
Actions
↓
Secondary Sections
↓
Advanced (collapsed)
```

The subsections below describe this project detail screen.

### Header

#### Structure

```tsx
<Header>
  <ProjectName />
  <Status />
  <PrimaryActions />
</Header>
```

---

#### Content

```txt
yeastcoast

● Online

[ Open Console ]   [ Settings ]
```

---

#### Rules

- no system language
- no stack identifiers unless subtle (#hash ok)
- keep lightweight

---

### Primary section: API

Component: `ApiPanel`.

#### Purpose

This is the MOST important part of the page.

---

#### Structure

```tsx
<ApiPanel>
  <Label />
  <ApiUrl />
  <CopyButton />
</ApiPanel>
```

---

#### Content

```txt
API URL

https://api--yeastcoast--ffca33f.vsl-base.com   [ Copy ]
```

---

#### Rules

- large, readable
- centered or prominent
- no clutter around it

---

### Status

Component: `StatusIndicator`.

#### Content

```txt
Online
```

Optional:

```txt
Running
```

---

#### Rules

- minimal
- no graphs unless meaningful
- no mesh telemetry bars

---

### Actions

Component: `ActionsBar`.

#### Structure

```tsx
<ActionsBar>
  <Button>Open Console</Button>
  <Button>View Logs</Button>
  <Button>Run Migration</Button>
</ActionsBar>
```

---

#### Rules

- clear, limited actions
- no obscure actions
- no duplication

---

### Environment (secondary)

Component: `EnvironmentPanel`.

#### Structure

```tsx
<EnvironmentPanel>
  <KeyValueList />
  <CopyButtons />
</EnvironmentPanel>
```

---

#### Rules

- collapsible if long
- no long instructions
- no inline docs

---

### Database (secondary)

Component: `DatabasePanel`.

#### Structure

```tsx
<DatabasePanel>
  <Button>Open database tools</Button>
</DatabasePanel>
```

---

#### Rules

- single action
- no clutter

---

### CLI

Component: `CliPanel`.

#### Structure

```tsx
<CliPanel>
  <Label />
  <CodeBlock />
  <CopyButton />
</CliPanel>
```

---

#### Content

```txt
CLI

flux push ./migrations/schema.sql
```

---

#### Rules

- small
- secondary
- not dominant

---

### Logs

Component: `LogsPanel`.

#### Structure

```tsx
<LogsPanel>
  <LogViewer />
</LogsPanel>
```

---

#### Rules

- optional visibility
- not default focus
- lazy-loaded if needed

---

### Advanced (collapsed)

Component: `AdvancedPanel`.

#### Contains

```txt
debug info
internal details
system state
```

---

#### Rules

```txt
collapsed by default
explicitly opened by user
```

---

## Visual Hierarchy

Priority order:

```txt
1. Project Name
2. API URL
3. Status
4. Actions
5. Everything else
```

---

## Layout Rules

### Container

```txt
max-width: ~900–1100px
centered
```

---

### Spacing

```txt
clear separation between sections
no dense stacking
```

---

### Alignment

```txt
left-aligned for detail view
centered for landing only
```

---

## What to Remove from Current UI

Remove:

```txt
duplicate panels
mesh telemetry bars
connection manifest blocks
log tap headers
long inline explanations
```

---

## UX Flow

User enters project:

```txt
Sees:
- Name
- Status
- API

Then:
- Copies API
- Opens console
```

Everything else is secondary.

---

## Anti-Goals

Do NOT:

```txt
turn this into a DevOps console
show all system layers
optimize for debugging first
```

---

## Final Principle

```txt
The user is building an app.

The dashboard should help them do that,
not explain how Flux works internally.
```

---

## Related

- [`dashboard-ux-principles.md`](dashboard-ux-principles.md) — principles and mental model
- [`dashboard-information-architecture.md`](dashboard-information-architecture.md) — IA and naming direction
- [`dashboard-copy-decisions.md`](dashboard-copy-decisions.md) — exact labels and copy
- [`dashboard-refactor-plan.md`](dashboard-refactor-plan.md) — phased execution plan
- [`dashboard-refactor-checklist.md`](dashboard-refactor-checklist.md) — step-by-step checklist
- [`dashboard-visual-redesign-pass.md`](dashboard-visual-redesign-pass.md) — what stays, goes, and changes
- [`dashboard-visual-design.md`](dashboard-visual-design.md) — colors, type, spacing, components
