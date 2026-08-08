# 2026-08-08 — Three failures that CI could not see

- Last updated: `2026-08-08`
- Impact: ~9 minutes of v2_shared tenant API downtime; two long-standing silent breakages found.

## What happened

Deploying Pass 6/6b and the Foundry contract work (PRs #5, #6) surfaced three separate
failures. All three passed `tsc`, `pnpm check:architecture`, and the full unit suite.

1. **Gateway crash-loop (outage).** `inbound-project-auth.ts` imported the `@flux/core`
   root barrel instead of a subpath. The barrel re-exports Docker-backed helpers, so
   esbuild inlined `dockerode`/`docker-modem`, which `require("ssh2")` at runtime — a
   module the slim gateway image does not carry and the Dockerfile marks external. The
   container crash-looped, Traefik lost its only backend, and tenant APIs returned 404
   until a fixed image was built.

2. **Dashboard unbuildable for a full release cycle.** Pass 6 (PR #2) reintroduced
   `apps/dashboard/middleware.ts` after an earlier commit had migrated to `proxy.ts`.
   Next 16 refuses to build when both exist. Nothing in CI runs `next build`, so this
   merged green. Consequence: the demo read-only guard Pass 6 shipped had **never run in
   production**, because the image carrying it was never buildable.

3. **Tenant migrations blocked by a missing grant.** Pass 6b moved pushed DDL from
   `postgres` to a per-tenant `t_<id>_ddl` role but did not re-derive that role's
   privileges. It had no `USAGE` on schema `auth`, so `CREATE POLICY … USING (col =
   auth.uid())` — the pattern the Auth.js and Clerk guides teach — failed with
   `permission denied for schema auth`. Serving traffic was unaffected and no existing
   tenant policy used `auth.uid()` (0 of 1,110), but the documented onboarding path was
   broken. The Pass 6b integration test missed it because its handcrafted policies never
   called into the `auth` schema.

The follow-up audit found two more of the same shape: `docs/` and the built CLI bundle
were never copied into the dashboard runner image, so `/docs/*` returned 404 and
`/api/install/cli` returned 503 in production while both looked correct in the repo.

## Root cause

Not five unrelated bugs. One pattern: **an invariant was verified at a layer that cannot
observe it.** Type checking cannot see a bundle. Unit tests cannot see a framework build.
SQL-string assertions cannot see a Postgres privilege. A repo checkout cannot see what is
missing from a container image.

## What changed

| Failure | Check added | Layer |
|---|---|---|
| Gateway crash-loop | `scripts/check-gateway-bundle.sh` + architecture rule | esbuild artifact |
| Dashboard unbuildable | `next build` in CI | framework build |
| Missing `auth` grant | `auth.uid()` in the Pass 6b fixture | live Postgres |
| Missing image assets | `RUN test -f` in the runner stage | container image |
| Outage on cutover | Unrouted canary in `bin/deploy-gateway.sh` | running container |

Each guard was verified to fail on the original defect, not merely to pass once fixed.

## Follow-ups

- `DEFAULT_EXCLUDED_SLUGS` in `packages/core/src/backup-policy.ts` hardcodes `static`, so
  any tenant using that slug is silently excluded from platform backups regardless of
  owner. One active project is currently affected (it holds no tables).
- Ten orphan tenant schemas and four `public` debug helpers remain, deferred by decision.
