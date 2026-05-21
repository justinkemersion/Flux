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

Place **`flux.json`** at a repository root with **`slug`** and **`hash`** so commands like **`flux push migrations/`** resolve the project **without** repeating **`--project`** / **`--hash`** on every invocation.

**Foundry apps** ship a placeholder hash (`REPLACE_AFTER_FLUX_INIT`). Run **`flux login`** then **`flux init`** once per machine/repo to link or create the project and replace the hash with the value from the control plane. You do not need to copy the hash manually from **`flux list`** for that workflow.

After init, optional fields may be present for tooling: **`apiUrl`**, **`mode`**, **`apiSchema`**. Secrets (**`jwt_secret`**, gateway signing keys) must **not** live in **`flux.json`**.

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

Before **`flux init`**, Foundry templates use:

```json
{
  "slug": "my-app",
  "hash": "REPLACE_AFTER_FLUX_INIT"
}
```

Use the **slug** and **hash** from **`flux list`** when creating **`flux.json` by hand**; use **`flux init`** when the repo already has the Foundry placeholder.

Exact schema follows CLI expectations—run `flux push --help` for current options.

## Example

Keep `flux.json` out of public repos if it embeds sensitive hints—or use environment overrides in CI.

## Next steps

- [CLI reference](/docs/reference/cli)
- [Create a project](/docs/getting-started/create-project)
