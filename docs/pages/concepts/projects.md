---
title: Projects
description: What a Flux project contains—more than a database name.
---

# Projects

A **Flux project** is the deployable backend unit: **database surface**, **REST API surface**, **routing identity**, **authentication configuration**, and **engine assignment** (v1 dedicated vs v2 shared).

## What you will learn

- Project vs database vs API
- What operators manage through CLI/dashboard
- Where to go for isolation details

## The idea

Calling a project “a database” understates what Flux provisions. The control plane tracks metadata, URLs, secrets, and lifecycle while the data plane serves queries. Slug and hash appear in hostnames; internal identifiers (like `tenant_id` on v2) are immutable even if marketing slugs change.

## How it works

Operators typically:

- Create / destroy projects
- Run **migrations** (`flux push`)
- Rotate secrets (carefully—see [Project secrets](/docs/security/project-secrets))
- Start / stop / repair stacks

Developers consume the **Service URL** and credentials appropriate to their engine.

## Example

```bash
flux create "billing-svc"
flux list
# Later: flux push … --project <slug> --hash <hash>   # values from flux list
```

Output includes identifiers you use in URLs and automation—not interchangeable with “just a Postgres URL” unless you bypass PostgREST entirely (not the default product path).

## Next steps

- [Pooled vs dedicated](/docs/concepts/pooled-vs-dedicated)
- [Tenant isolation (architecture)](/docs/architecture/tenant-isolation)
