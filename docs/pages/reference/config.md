---
title: Configuration
description: flux.json, dashboard settings, and CLI context for day-to-day work.
---

# Configuration

Flux configuration spans **repo-level** developer ergonomics and **per-project** secrets managed by the control plane.

## What you will learn

- `flux.json` purpose
- Where dashboard stores project metadata
- How to avoid repeating `-p` / `--hash` flags

## The idea

### flux.json

Place **`flux.json`** at a repository root with **slug** (and **hash** when required) so `flux push ./migration.sql` can target the right project without repeating CLI flags.

### Dashboard

Project screens surface **Service URL**, engine, and rotation controls for secrets—prefer UI + API over ad-hoc container edits.

### Codex / assistant rules

Structured CLI + architecture rules for assistants live in `FLUX_CODEX_JSON` (`apps/dashboard/src/lib/flux-codex-static.ts`).

## How it works

```json
{
  "slug": "my-app",
  "hash": "a1b2c3d"
}
```

Exact schema follows CLI expectations—run `flux push --help` for current options.

## Example

Keep `flux.json` out of public repos if it embeds sensitive hints—or use environment overrides in CI.

## Next steps

- [CLI reference](/docs/reference/cli)
- [Create a project](/docs/getting-started/create-project)
