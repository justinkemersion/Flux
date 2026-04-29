# Flux UI Scope Contract (CLI-First)

This contract defines what the Flux UI is for, what it is not for, and how we revisit scope decisions before misunderstandings become product drift.

## Product posture

- Flux is CLI-first.
- The dashboard is a control-plane companion, not the primary operator interface.
- Simplicity and reliability are prioritized over feature breadth.

## Dashboard mission (what UI should do)

- Show project health, status, and safety-critical context.
- Support low-friction onboarding actions where UX meaningfully removes operator mistakes.
- Expose minimal, opinionated controls for common operational workflows.
- Link users to CLI commands and docs for advanced workflows.

## Explicit non-goals (what UI should not become)

- A full database IDE/workbench.
- A clone of Supabase Studio-style breadth.
- A high-maintenance settings surface with deep nested configuration.
- A replacement for power-user CLI and external DB tools.

## UI admission criteria for new features

A new dashboard feature should only ship if it passes all checks:

1. It removes a meaningful onboarding or operational blocker.
2. It can be explained in one sentence.
3. It has a small maintenance surface (low long-term complexity).

If a proposal fails any check, default to CLI/docs instead of UI.

## Tooling boundary (Database Tools direction)

- Keep lightweight and guarded actions in UI only when they reduce mistakes.
- Route power-user workflows to CLI by default.
- Prefer links, copyable commands, and runbook pointers over adding UI controls.

Current direction:

- `Import SQL dump`: possible limited UI affordance if tightly scoped and safe.
- `Seed runner`: CLI-first with dashboard hints/status, not full UI orchestration.
- `Table browser`: out of scope for dashboard; point to external DB clients.

## Decision protocol (to avoid misunderstandings)

For any non-trivial UI feature proposal:

1. Write a short decision note in the PR description (or issue):
   - Problem
   - Why UI (vs CLI/docs)
   - Scope boundaries
   - Rollback/de-scope plan
2. Confirm this contract is explicitly referenced.
3. If trade-offs are unclear, default to not shipping UI in that iteration.

## Revisit cadence

Revisit this contract on a fixed cadence and on trigger events.

- Fixed cadence: every 4 weeks.
- Trigger revisit immediately when:
  - two or more UI scope disagreements happen in a sprint, or
  - a proposed feature fails admission criteria but is still considered for UI, or
  - maintenance burden from dashboard complexity causes delivery slowdown.

Revisit checklist:

1. What shipped in UI since last review?
2. Which items should have stayed CLI/docs?
3. What should be de-scoped or removed?
4. Are we still CLI-first in practice, not just wording?
5. What decisions need to be documented to prevent repeat debate?

## Enforcement

- This contract is the default tie-breaker for UI scope decisions.
- In ambiguous cases, choose the simpler path with lower maintenance cost.
- Prefer shipping CLI capability first; add UI only when repeatedly justified by operator friction.
