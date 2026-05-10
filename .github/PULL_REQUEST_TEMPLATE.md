# Pull Request

## Summary

- What problem does this change solve?
- Why is this approach the right one?

## Test Plan

- [ ] Local verification steps completed
- [ ] Relevant automated checks passed
- [ ] `pnpm check:architecture` passes locally

## Architecture Checklist

See `docs/ARCHITECTURE-CONTRACT.md` for the rules behind these checks. Mark each box, or write "N/A" with a one-line reason.

### Public exports

- [ ] `packages/core/src/index.ts` still contains only `export ... from "./..."` re-exports.
- [ ] `packages/cli/src/index.ts` is still a thin entrypoint (no command logic added).
- [ ] Any new public export from `@flux/core`, `@flux/cli`, or `@flux/sdk` is intentional and documented.
- [ ] Removed/renamed public exports were checked across `apps/dashboard` and `packages/*`.

### Module boundaries

- [ ] New code lives in the right room (`projects/`, `docker/`, `database/`, `traefik/`, `runtime/`, `commands/`, `api-client/`, `output/`, `lib/...`).
- [ ] No new junk-drawer files (`utils.ts`, `helpers.ts`, `misc.ts`, `common.ts`).
- [ ] CLI does not reach into Docker/Postgres directly; dashboard does not import CLI internals.

### v1 / v2 seams

- [ ] v1_dedicated and v2_shared paths remain separable; shared logic stays behind helpers in `@flux/core`.
- [ ] Mode-specific assumptions (schema names, hostnames, env shape) are not leaked across the seam.
- [ ] Tenant URL / schema name changes were validated against both engines where applicable.

### Tests

- [ ] Pure logic extracted in this PR has focused unit tests.
- [ ] `pnpm test` passes locally (or the failing tests are explained).

### Docs

- [ ] Operator-visible behavior changes are reflected in `README.md`, `docs/OPERATIONS.md`, or relevant guide.
- [ ] If a boundary moved, `docs/ARCHITECTURE-CONTRACT.md` was updated.
- [ ] `AGENTS.md` / CLI help text updated if the operator contract changed.

## UI Scope Check (Required for UI/dashboard changes)

If this PR touches dashboard/UI behavior, complete all items below.
If not, write "N/A" and explain why.

- [ ] This change aligns with `docs/UI-SCOPE-CONTRACT.md`
- [ ] UI is necessary vs CLI/docs (brief reason)
- [ ] Scope is intentionally minimal (one-sentence boundary)
- [ ] Maintenance burden is low (brief reason)
- [ ] De-scope/rollback path is identified if complexity grows

Notes:

- Problem:
- Why UI (vs CLI/docs):
- Scope boundary:
- Revisit trigger (what would cause us to pull this back to CLI/docs):
