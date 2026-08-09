# CLI build provenance and the stale-artifact guard

Operators run the **compiled** CLI (`packages/cli/dist/index.cjs`), not the TypeScript sources.
A bundle built before a fix landed keeps executing the old logic, and the pinned version string
cannot reveal it: `flux -V` reports the same `2.0.1` for every build of that release line.

On 2026-08-08 the linked `dist/index.cjs` was built at **08:26** while the pooled-push lexical
fix landed at **17:13**. Nothing in the CLI surface distinguished the two, so production
migration work had to be driven through `tsx` against source. This guard exists so that
situation fails loudly instead of silently.

## Provenance model

Provenance is **embedded at build time** by `packages/cli/tsup.config.ts`, which injects a
JSON blob via esbuild `define` into the constant `__FLUX_BUILD_PROVENANCE__`:

| Field                | Source                                       |
| -------------------- | -------------------------------------------- |
| `version`            | `packages/cli/package.json`                  |
| `sourceSha`          | `git rev-parse HEAD` at build                |
| `sourceDirtyAtBuild` | `git status --porcelain --untracked-files=no` |
| `buildTimestamp`     | build clock (ISO 8601)                       |
| `buildRepoRoot`      | `git rev-parse --show-toplevel` at build     |

At runtime the CLI reads the embedded commit and compares it with the **current HEAD of the
checkout the bundle was built from**. No decision uses file mtimes. Because `define` is a
static substitution, environment variables cannot forge provenance: under `tsx` the constant
never exists, so the runtime reports `source`.

### Statuses

| Status         | Meaning                                                      | Production mutation |
| -------------- | ------------------------------------------------------------ | ------------------- |
| `source`       | Running TypeScript directly; the running code *is* the checkout | allowed           |
| `verified`     | Embedded commit equals the build repo's current HEAD, tree clean | allowed         |
| `unverifiable` | Provenance present, but no build checkout on this machine (installed release) | allowed |
| `stale`        | Embedded commit differs from HEAD, or the checkout is dirty   | **blocked**        |
| `unknown`      | No embedded commit, or the bundle was built from a dirty tree | **blocked**        |

`unverifiable` is allowed because a released bundle installed via
`curl -sL .../install | bash` has established provenance and no local source to drift from;
its provenance is printed rather than silently trusted. Dirtiness ignores **untracked** files,
which cannot be imported by committed code.

## Inspecting provenance

```bash
flux version --json
```

```json
{
  "version": "2.0.1",
  "runtime": "bundle",
  "sourceSha": "460a4aade32fd87b86870b59412f27880e10a685",
  "sourceDirtyAtBuild": false,
  "buildTimestamp": "2026-08-09T10:32:05.517Z",
  "buildRepoRoot": "/home/justin/Projects/flux",
  "sourceCheckout": { "headSha": "460a4aade32f…", "dirty": false },
  "provenanceStatus": "verified",
  "productionMutationAllowed": true
}
```

A bundle built before this guard shipped reports `"provenanceStatus": "unknown"` and is
refused for production mutations — that is the intended bootstrap behavior.

## Guarded commands

These execute SQL against a tenant or destroy tenant resources, and fail closed on `stale`
or `unknown`:

- `flux push` (apply only)
- `flux migrate` (without `--dry-run`)
- `flux db-reset`
- `flux db restore`
- `flux nuke`
- `flux reap`

Read-only and preview paths stay usable so a stale CLI can still be diagnosed. `flux push
--plan`, `flux push --dry-run`, `flux migrate --dry-run` and `flux migrations list` print a
warning and continue.

## Recovering from a block

```
Error: Refusing to run `flux push`: the compiled CLI cannot be shown to match its source.

  status         stale
  reason         Artifact was built from 460a4aade32f but the source checkout is at be729630b1a0.
```

Rebuild from the current checkout:

```bash
cd /path/to/flux
git pull
pnpm --filter @flux/cli build
flux version --json   # expect provenanceStatus: verified
```

Commit or stash work first: building from a dirty tree yields `unknown`, because no commit
describes the bundle's contents.

### Emergency override

`FLUX_ALLOW_STALE_CLI=1` proceeds anyway and prints a warning naming the command and status.
It is a documented emergency exception, not a workflow step: record the reason in the relevant
plan or incident note when used.

## Scope limit: the pooled-push adapter is server-side

The pooled-push SQL adaptation (`adaptPooledPushSql`) runs in the **control plane**
(`apps/dashboard/src/lib/pooled-push.ts`), not in the CLI. It is not bundled into
`dist/index.cjs`. This guard therefore covers CLI-side production behavior — push mode
inference, migration ledger and checksum handling, backup gates, confirmation prompts — but
**not** the deployed dashboard's adapter version.

That second boundary has its own contract:
[control-plane build provenance](./CONTROL-PLANE-PROVENANCE.md). **Production migration
readiness requires both a verified CLI artifact and a verified compatible deployed control
plane.** Check both with:

```bash
flux version --json          # this artifact
flux control-plane verify    # both controls, single READY / NOT READY verdict
```

## Related documentation

- [Installation](./pages/getting-started/installation.md)
- [Operations runbook](./OPERATIONS.md)
- [2026-08-08 deploy and privilege failures](./incidents/2026-08-08-deploy-and-privilege-failures.md)
