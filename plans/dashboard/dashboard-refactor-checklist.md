# Flux Dashboard: Refactor Checklist

## Status

Ready for execution (v0)

---

## Objective

Provide a step-by-step checklist to refactor the dashboard UI safely and incrementally.

Each step should:

- be small
- be testable
- leave the app in a working state
- map to a clean commit

---

## How to use this

For each step:

1. Implement only what is listed
2. Verify UI still works
3. Commit
4. Move to next step

Do NOT batch steps together.

---

## Phase 1 — Language cleanup

### Goal

Replace system-facing labels with user-facing language.

---

### Checklist

- [ ] Replace `CONNECTION_MANIFEST` → `Connection`
- [ ] Replace `MESH_TELEMETRY` → `Status`
- [ ] Replace `LOG_TAP` → `Logs`
- [ ] Replace `APP_ENV` → `Environment`
- [ ] Replace `POSTGREST API` → `API URL`
- [ ] Replace `OPERATIONAL` / `ACTIVE_RUNNING` → `Online`

---

### Verify

- UI renders correctly
- No layout shifts
- Labels are readable and consistent

---

### Commit

```txt
refactor: normalize dashboard language
```

---

## Phase 2 — Remove duplicate panels

### Goal

Eliminate repeated UI blocks.

---

### Checklist

- [ ] Identify duplicate Connection panels
- [ ] Identify duplicate Environment panels
- [ ] Remove extra instances
- [ ] Ensure each concept appears only once

---

### Verify

- No missing data
- No visual duplication
- Layout still functional

---

### Commit

```txt
refactor: remove duplicate dashboard panels
```

---

## Phase 3 — Introduce project header

### Goal

Create a clear entry point for the page.

---

### Checklist

- [ ] Create `<ProjectHeader />` component
- [ ] Move project name into header
- [ ] Move status indicator into header
- [ ] Add primary actions (`Open Console`, `Settings`)
- [ ] Remove redundant top-level labels

---

### Verify

- Header is visually distinct
- Status is visible immediately
- Actions are accessible

---

### Commit

```txt
feat: add project header with status and actions
```

---

## Phase 4 — Extract API panel

### Goal

Make API URL the primary focus.

---

### Checklist

- [ ] Create `<ApiPanel />`
- [ ] Move API URL into panel
- [ ] Add copy button
- [ ] Remove surrounding noise / duplicate labels
- [ ] Increase visual prominence (spacing, size)

---

### Verify

- API is immediately visible
- Copy action works
- No duplicate API displays

---

### Commit

```txt
feat: extract API panel as primary element
```

---

## Phase 5 — Create actions bar

### Goal

Centralize user actions.

---

### Checklist

- [ ] Create `<ActionsBar />`
- [ ] Add:
  - [ ] Open Console
  - [ ] View Logs
  - [ ] Run Migration (if applicable)
- [ ] Remove scattered buttons across UI
- [ ] Remove duplicate actions

---

### Verify

- All actions still accessible
- UI feels cleaner
- No duplicated buttons remain

---

### Commit

```txt
feat: consolidate actions into actions bar
```

---

## Phase 6 — Reorganize sections

### Goal

Create a clean vertical structure.

---

### Checklist

- [ ] Create distinct sections:
  - [ ] Environment
  - [ ] Database
  - [ ] CLI
  - [ ] Logs
- [ ] Ensure each section appears once
- [ ] Remove panel stacking
- [ ] Remove unnecessary headers

---

### Verify

- Sections are clearly separated
- No duplication
- Flow feels natural (top → bottom)

---

### Commit

```txt
refactor: organize dashboard into structured sections
```

---

## Phase 7 — Collapse advanced content

### Goal

Hide complexity by default.

---

### Checklist

- [ ] Create `<AdvancedPanel />`
- [ ] Move into it:
  - [ ] debug info
  - [ ] system state
  - [ ] extra logs
- [ ] Set collapsed by default
- [ ] Add toggle to expand

---

### Verify

- Default UI is simpler
- Advanced data still accessible
- No lost functionality

---

### Commit

```txt
feat: add collapsible advanced panel
```

---

## Phase 8 — Remove telemetry noise

### Goal

Eliminate low-value visuals.

---

### Checklist

- [ ] Remove mesh telemetry bars
- [ ] Remove segmented status visuals
- [ ] Remove decorative system indicators
- [ ] Keep only simple status (Online / Offline)

---

### Verify

- UI feels calmer
- No meaningful info lost
- Status still clear

---

### Commit

```txt
refactor: remove telemetry visuals
```

---

## Phase 9 — Simplify CLI section

### Goal

Reduce CLI to essential usage.

---

### Checklist

- [ ] Reduce CLI to single example
- [ ] Remove explanation text
- [ ] Keep mono font
- [ ] Ensure it is visually secondary

---

### Verify

- CLI is readable
- Not visually dominant
- Still useful

---

### Commit

```txt
refactor: simplify CLI section
```

---

## Phase 10 — Environment cleanup

### Goal

Make environment readable and minimal.

---

### Checklist

- [ ] Display as key/value list
- [ ] Add copy buttons
- [ ] Remove inline documentation
- [ ] Collapse if long

---

### Verify

- Easy to scan
- Easy to copy
- No clutter

---

### Commit

```txt
refactor: simplify environment display
```

---

## Phase 11 — Spacing and layout pass

### Goal

Align with visual design doc.

---

### Checklist

- [ ] Increase vertical spacing between sections
- [ ] Remove tight stacking
- [ ] Remove heavy borders
- [ ] Ensure consistent alignment
- [ ] Apply neutral color palette

---

### Verify

- UI feels calm
- Nothing feels cramped
- Sections are distinct

---

### Commit

```txt
style: apply spacing and layout improvements
```

---

## Phase 12 — Final cleanup

### Goal

Ensure consistency and polish.

---

### Checklist

- [ ] Remove leftover system labels
- [ ] Ensure all text follows copy rules
- [ ] Check all buttons for consistency
- [ ] Validate hierarchy (API → Status → Actions)
- [ ] Test responsiveness

---

### Verify

- Dashboard feels intentional
- No debug language visible
- Everything is easy to understand

---

### Commit

```txt
chore: finalize dashboard refactor
```

---

## Final validation

After all phases:

- [ ] API is instantly visible
- [ ] Status is clear
- [ ] Actions are obvious
- [ ] No duplicate panels
- [ ] No system jargon
- [ ] UI feels calm and minimal

---

## Final principle

```txt
Small steps. Clean commits. No drift.
```

---

## Related

- [`dashboard-refactor-plan.md`](dashboard-refactor-plan.md) — strategy and phase rationale
- [`dashboard-copy-decisions.md`](dashboard-copy-decisions.md) — labels (Phase 1)
- [`dashboard-component-spec.md`](dashboard-component-spec.md) — target components
- [`dashboard-visual-design.md`](dashboard-visual-design.md) — spacing and palette (Phase 11)
- [`dashboard-visual-redesign-pass.md`](dashboard-visual-redesign-pass.md) — keep / remove / simplify
