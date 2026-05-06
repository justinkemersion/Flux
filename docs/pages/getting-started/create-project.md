---
title: Create a project
description: Provision a Flux project with the CLI and apply your first schema migration.
---

# Create a project

A **Flux project** is the unit you provision: database surface, API, routing identity, and auth configuration. Creating one should leave you with a **Service URL** and enough credentials to continue.

## What you will learn

- The basic `flux create` flow
- How **`flux list`** gives the **slug** and **hash** the CLI expects for project-scoped commands
- How **`flux push`** targets a project with **`--project`** and **`--hash`** (or `flux.json`)

## The idea

`flux create` talks to the control plane, which schedules provisioning for your **engine** (v1 dedicated or v2 shared depending on tier/configuration). You do not pick “a different product”—you get a project; the engine describes how infrastructure is shared.

After create, you apply SQL from your repo with **`flux push`**. For any command that mutates an **existing** project, the CLI needs to know **which** project: pass **`--project <slug>`** and **`--hash <7hex>`** (or put the same fields in repo-root **`flux.json`** so you can omit the flags). Those values always come from **`flux list`** (or the dashboard), not from guesswork.

`flux push` updates the tenant database and triggers PostgREST reload so new tables appear in the API (for v2 pooled, tables belong in the tenant API schema—see [Migrations](/docs/concepts/migrations)).

## How it works

Create a project (name becomes the slug unless your host normalizes it):

```bash
flux create "percept"
```

List projects and copy the **slug** and **hash** for the row you care about:

```bash
flux list
```

Push a migration file using the documented project selector (replace slug/hash with **your** `flux list` output):

```bash
flux push db/migrations/0001_moods.sql --project percept --hash b915ec8
```

The same pattern applies to other project-scoped commands that accept **`--project`** / **`--hash`**—see **`flux push --help`** and related subcommands.

The CLI and dashboard also print the **Service URL** for your app. Canonical v2 host shape is under [Service URLs](/docs/concepts/service-urls).

## Example

Minimal `schema.sql` (illustrative only—your tenant schema name on v2 is assigned by the platform):

```sql
-- On v2 shared, tables belong in your tenant API schema (t_<shortId>_api).
-- Use the schema name from errors, dashboard, or gateway profile headers.
CREATE TABLE IF NOT EXISTS notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body text NOT NULL
);
```

## Next steps

- [First request](/docs/getting-started/first-request)
- [Projects](/docs/concepts/projects)
