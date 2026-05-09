---
title: Configuration
description: flux.json, dashboard settings, and CLI context for day-to-day work.
section: reference
---

# Configuration

Flux configuration spans **repo-level** developer ergonomics and **per-project** secrets managed by the control plane.

## What you will learn

- `flux.json` purpose
- Where dashboard stores project metadata
- How to avoid repeating `-p` / `--hash` flags

## The idea

### flux.json

Place **`flux.json`** at a repository root with **`slug`** and **`hash`** (both from **`flux list`**) so commands like **`flux push db/migrations/0001_moods.sql`** resolve the project **without** repeating **`--project`** / **`--hash`** on every invocation.

Commands that accept **`--project`** and **`--hash`**—including **`flux migrate`**—do **not** require **`flux.json`** when you pass both flags every time from any working directory.

### Dashboard

Project screens surface **Service URL**, engine, and rotation controls for secrets—prefer UI + API over ad-hoc container edits.

### Codex / assistant rules

Structured CLI + architecture rules for assistants ship as JSON: fetch **`GET /api/cli/v1/codex`** on your Flux dashboard, or supply the payload as **`FLUX_CODEX_JSON`** when wiring an assistant.

## How it works

```json
{
  "slug": "percept",
  "hash": "b915ec8"
}
```

Use the **slug** and **hash** from **`flux list`** for your real project (the values above are illustrative).

Exact schema follows CLI expectations—run `flux push --help` for current options.

## Example

Keep `flux.json` out of public repos if it embeds sensitive hints—or use environment overrides in CI.

## Next steps

- [CLI reference](/docs/reference/cli)
- [Create a project](/docs/getting-started/create-project)
