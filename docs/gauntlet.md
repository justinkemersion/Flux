# Flux Gauntlet

Calm surface, ruthless underneath.

The Flux Gauntlet is a repeatable end-to-end audit runner for the Flux control plane. It creates a **disposable** project, pushes a tiny schema, verifies PostgREST API behavior, optionally creates and verifies a backup, cleans up, and writes machine-readable and human-readable reports.

This is **not** a general test framework, dashboard feature, SQL editor, or database browser. It is the first disciplined audit loop for Flux: small, repeatable, inspectable, and trustworthy.

## Ring 3 status (v1_dedicated)

```txt
Ring 3: Schema Introspection Deepening — GREEN (2026-06-20)
```

Adds `inspect_schema_deep` to Ring 1 and optional `schema_still_intact` in Ring 2 `push_invalid_sql`.

## Ring 2 status (v1_dedicated Matrix Lite)

```txt
Ring 2: CLI Matrix Lite — GREEN (2026-06-20 checkpoint)
```

Checkpoint: [`packages/cli/reports/gauntlet/ring2-checkpoint-2026-06-20/checkpoint-summary.md`](../packages/cli/reports/gauntlet/ring2-checkpoint-2026-06-20/checkpoint-summary.md)

Regression at checkpoint: Ring 1 **5/5** + Ring 2 matrix **7/7**, **0 cleanup leaks**.

## Ring 1 status (v1_dedicated)

```txt
Ring 1: Smoke / Lifecycle / Backup spine — GREEN (2026-06-20 soak: 25/25 PASS)
```

Soak checkpoint: [`packages/cli/reports/gauntlet/ring1-soak-2026-06-20/soak-summary.md`](../packages/cli/reports/gauntlet/ring1-soak-2026-06-20/soak-summary.md)

`v2_shared` health, push, and API probes mint a short-lived project JWT with a stable CLI subject, then exercise the gateway's project-JWT → bridge-JWT handshake. Missing credentials or routes remain explicit skips/failure classifications, never a synthetic pass.

## What it does

Each `flux gauntlet run` cycle:

1. **Preflight** — Docker engine reachable; CLI authenticated
2. **Create project** — disposable slug `gauntlet-<timestamp>-<random>` (or custom `--prefix`)
3. **Wait for health** — PostgREST returns a valid OpenAPI document (not merely “not 502”)
4. **Push schema** — writes `schema.sql` to the report dir, pushes via existing CLI/dashboard routes
5. **Inspect schema** — OpenAPI cache exposes `gauntlet_notes` and `gauntlet_events`
6. **Inspect schema (deep)** — Postgres catalog introspection (tables, columns, FKs, RLS, grants, warnings)
7. **API insert / anonymous inertness / select** — inserts a known row with credentials, proves anonymous reads and writes are inert, then verifies authenticated selection
8. **Backup create / verify** — uses `flux backup` CLI API paths (v1 full DB; v2 tenant export when supported)
9. **Cleanup** — deletes only projects created by this process and matching the strict gauntlet slug marker
10. **Report finalization** — writes artifacts (not counted as a validation stage)

## How to run

From the monorepo root:

```bash
# Default: one v1_dedicated run
pnpm run flux gauntlet run

# Explicit options
pnpm run flux gauntlet run \
  --mode v1_dedicated \
  --runs 1 \
  --report-dir reports/gauntlet \
  --prefix gauntlet

# Keep failed project for inspection (skips cleanup when the run fails)
pnpm run flux gauntlet run --keep-failed

# Skip backup stages (faster local iteration)
pnpm run flux gauntlet run --skip-backup

# JSON summary on stdout
pnpm run flux gauntlet run --json
```

From `packages/cli` directly (equivalent):

```bash
pnpm flux gauntlet run --mode v1_dedicated --runs 1
```

### Invocation pitfall

Do **not** insert an extra `--` between `flux` and `gauntlet`:

```bash
# Wrong — pnpm passes a stray `--` to Commander
pnpm run flux -- gauntlet run --mode v1_dedicated --runs 1

# Correct
pnpm run flux gauntlet run --mode v1_dedicated --runs 1
```

Requires a configured Flux environment (`flux login`, Docker, control plane reachable).

### Soak tiers

```bash
pnpm run flux gauntlet run --mode v1_dedicated --runs 5
pnpm run flux gauntlet run --mode v1_dedicated --runs 25
```

No new rings until cleanup is boring. After a soak batch, write or refresh `soak-summary.md` under `reports/gauntlet/ring1-soak-<date>/` (see the 2026-06-20 checkpoint for format).

### Integration test (opt-in)

```bash
FLUX_RUN_GAUNTLET_INTEGRATION=1 pnpm --filter cli test
```

## Reports

Each run writes a directory under `--report-dir`:

```text
reports/gauntlet/<runId>/
  report.json
  report.md
  stdout.log
  stderr.log
  command-manifest.json
  schema.sql
  schema-introspection.json      # OpenAPI snapshot (Ring 1)
  schema-inspection.json         # Ring 3 deep Postgres catalog
  schema-graph.json
  schema-warnings.json
  project-summary-before.json
  project-summary-after.json     # after successful cleanup
```

Report writing is **finalization** — a report write failure is logged but does not change the run pass/fail outcome.

### Failure classification

Failed runs include `failureClass` and `failureClassDetail` in `report.json` and a **Failure Classification** section in `report.md`. This helps distinguish platform failures from gauntlet gaps (especially on v2):

| Class | Meaning |
|-------|---------|
| `auth_handshake_mismatch` | v2 probe JWT does not match gateway bridge handshake |
| `unsupported_mode_path` | v2 route/path unavailable; gauntlet did not invent internals |
| `probe_model_unimplemented` | v2 probe helper not implemented yet |
| `platform_failure` | Likely real Flux/platform issue (default for v1 failures) |

## Safety

- Only operates on slugs matching `gauntlet-<timestamp>-<random>` (or `--prefix` variant)
- Maintains an in-memory `createdProjectSlugs` set for the process — cleanup refuses unknown slugs
- Never deletes arbitrary projects
- Gauntlet-only `skipBackupCheck` on disposable cleanup (isolated from operator `flux nuke` workflows)

## v1 vs v2

| Stage | v1_dedicated | v2_shared |
|-------|--------------|-----------|
| Create / delete | Full support | Full support via CLI API |
| Health / API | Full support (`serviceRoleJwt`; anonymous RLS canary) | Full support when project JWT credentials are returned; gateway rejection is the anonymous canary |
| Push schema | CLI `/cli/v1/push` via file | Dashboard push when `projectJwt` present; otherwise **skipped** |
| Backup | Full support | Same CLI backup API (`tenant_export`) when available |

If a v2 project JWT or push route is unavailable, the report marks that path as skipped/unsupported instead of claiming a security pass.

## Ring 2: CLI Matrix Lite (v1 only)

Operator-behavior scenarios beyond Ring 1 happy path. Same stage/report/cleanup architecture — not a second gauntlet system.

```bash
# All Ring 2 scenarios
pnpm run flux gauntlet matrix --mode v1_dedicated

# Single scenario
pnpm run flux gauntlet matrix --scenario push_invalid_sql

# Keep failed scenario projects for inspection
pnpm run flux gauntlet matrix --keep-failed --json
```

`v2_shared` is refused with a clear error. v2 remains parked:

```txt
v2_shared: honest gap — gateway JWT probe model not implemented
```

### Scenarios

| Scenario | Proves |
|----------|--------|
| `create_duplicate_project` | Duplicate create rejected (409); original cleaned up |
| `push_invalid_sql` | Invalid SQL fails; API stays healthy; project deletable |
| `env_set_and_list_redaction` | Env set/list works; sensitive values redacted |
| `stop_start_project` | Stop/start lifecycle; health returns |
| `double_stop_project` | Second stop is idempotent or cleanly rejected |
| `missing_project_errors` | Missing-project ops fail with not-found errors; no cleanup attempted |
| `backup_gate_blocks_destructive_action` | Operator nuke blocked without restore-verified backup; gauntlet cleanup still works |

### Matrix reports

```text
reports/gauntlet/matrix-<timestamp>/
  matrix-summary.json
  matrix-summary.md
  <scenarioName>/
    report.json
    report.md
    command-manifest.json
    schema.sql / invalid.sql   # when applicable
```

**Reading the summary:** `matrix-summary.json` aggregates batch totals (`passed`, `failed`, `skipped`, `cleanupLeaks`) and per-scenario `reportPath` / `failureClass`. Open each scenario’s `report.md` for stage timelines. A non-zero `cleanupLeaks` means a disposable project was created but not deleted (unless `--keep-failed`). `matrix-summary.md` mirrors the JSON with a pass/fail decision line.

### Verification

```bash
pnpm --filter cli test
pnpm --filter cli typecheck   # included in root pnpm typecheck
pnpm run flux gauntlet matrix --mode v1_dedicated
```

CLI typecheck follows `@flux/core` source (`.ts` extension imports). Both packages use `allowImportingTsExtensions: true` in their tsconfigs.

## Ring 3: Schema Introspection Deepening (v1 only)

Reusable Postgres catalog introspection for gauntlet reports today; Schema Story UI later.

Ring 1 adds stage **`inspect_schema_deep`** after OpenAPI `inspect_schema`. Writes:

```text
schema-inspection.json
schema-graph.json
schema-warnings.json
```

Standalone command (existing projects):

```bash
pnpm run flux gauntlet inspect-schema --project <slug> --hash <hash>
```

`v2_shared` is refused — same honest gap as other gauntlet probe paths.

### Schema inspection path (v1)

Deep inspection uses **fixed server-owned catalog queries** — no arbitrary SQL from the CLI.

1. **CLI API (remote default)** — `POST /api/cli/v1/projects/:hash/schema-inspection`  
   Optional body: `{ "includeExactCounts": true }` (gauntlet audit runs). Default: estimated row counts only.  
   Rejects SQL-shaped input (`sql`, `queries`, `tableNames`).
2. **Local Docker (operator fallback)** — when `FLUX_SCHEMA_INSPECT_LOCAL=1` and CLI shares the project Docker host (including `DOCKER_HOST=ssh://…` to the Flux node)

Generic ad-hoc SQL (`POST …/query`) is **not exposed in production**. It returns **404** unless `FLUX_CLI_ALLOW_ADHOC_QUERY=1` on the dashboard (development only).

Ring 3 remote GREEN is defined as gauntlet passing **without** `FLUX_SCHEMA_INSPECT_LOCAL` or `DOCKER_HOST` against the hosted control plane (`flux.vsl-base.com`).

```bash
unset FLUX_SCHEMA_INSPECT_LOCAL DOCKER_HOST
pnpm run flux gauntlet inspect-schema --project <slug> --hash <hash>
pnpm run flux gauntlet run --mode v1_dedicated --runs 1
pnpm run flux gauntlet matrix --mode v1_dedicated
```

`v2_shared` receives `501` with `{ "error": "schema_inspection_unsupported", "mode": "v2_shared" }`.

### Warning codes

| Code | Severity | Meaning |
|------|----------|---------|
| `table_without_primary_key` | warning | Table has no PK |
| `foreign_key_without_index` | warning | FK columns lack supporting index |
| `rls_disabled` | warning | RLS off on API table |
| `rls_enabled_without_policies` | warning | RLS on, but no explicit policies exist |
| `empty_schema` | warning | No user tables in schema |
| `wide_table` | info | More than 25 columns |
| `nullable_foreign_key` | info | Nullable FK column |

Warnings are informational — they do not fail Ring 1 unless a stage explicitly asserts otherwise. Dedicated `flux push` separately fails closed on either RLS warning because that engine has no gateway auth layer.

The `api_unauth_inert` stage runs on both engines after inserting a known row with credentials. It proves an anonymous caller cannot read that row and cannot insert another one. A v2 gateway `401`/`403` and a dedicated RLS-filtered `200 []` are both valid read outcomes; anonymous writes must return `401` or `403`.

Ring 2 uses deep inspection only in `push_invalid_sql` (`schema_still_intact` stage).

**Checkpoint:** [`packages/cli/reports/gauntlet/ring3-checkpoint-2026-06-20/checkpoint-summary.md`](../../packages/cli/reports/gauntlet/ring3-checkpoint-2026-06-20/checkpoint-summary.md) — Ring 3 remote GREEN (2026-06-20).

## What it does not test yet (future rings)

### Ring 3 candidate

**Schema Introspection Deepening** — implemented for v1_dedicated; see Ring 3 section above. Schema Story Preview UI is deferred until remote path is GREEN.

### Later rings

- Chaos mode / fault injection
- Full CLI option matrix regression
- Randomized schema seeds
- Side-by-side v1/v2 comparison runs
- Schema Story introspection reuse
- AI diagnosis summaries
- v2 gateway JWT probe model

Clean seams are left in `packages/cli/src/gauntlet/` for these rings.
