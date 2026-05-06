---
title: Create a project
description: Provision a Flux project with the CLI and apply your first schema migration.
---

# Create a project

A **Flux project** is the unit you provision: database surface, API, routing identity, and auth configuration. Creating one should leave you with a **Service URL** and enough credentials to continue.

## What you will learn

- The basic `flux create` flow
- How schema changes land with `flux push`
- Where to read URLs and keys in output / dashboard

## The idea

`flux create` talks to the control plane, which schedules provisioning for your **engine** (v1 dedicated or v2 shared depending on tier/configuration). You do not pick “a different product”—you get a project; the engine describes how infrastructure is shared.

After create, you apply SQL from your repo with **`flux push`** so PostgREST sees tables in the correct schema (for v2 pooled, that is typically the tenant schema, not an ad-hoc `public` assumption—see [Migrations](/docs/concepts/migrations)).

## How it works

```bash
flux create "my-app"
```

Then:

```bash
flux push ./schema.sql
flux list
```

The CLI and dashboard print the **Service URL** you will call from applications. Canonical v2 host shape is documented under [Service URLs](/docs/concepts/service-urls).

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
