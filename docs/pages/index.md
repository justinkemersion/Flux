---
title: Flux documentation
description: PostgreSQL-first backend platform with managed projects, REST APIs, migrations, JWTs, and row-level security.
---

# Flux documentation

Flux is a **PostgreSQL-first** platform for running many isolated **projects**: each project gets a **database surface**, a **REST API** (PostgREST), **routing identity**, and **authentication** configuration. You evolve the system with **SQL migrations**, not a proprietary object layer.

## What you will learn

- Where to start if you are new vs. returning
- The three ideas Flux keeps repeating
- How the docs are organized

## The idea

Flux orchestrates infrastructure (containers, routing, secrets) so you can treat each project as a small, repeatable backend. **v2 shared** packs many tenants onto a shared cluster with schema- and role-level isolation and a **gateway** at the edge. **v1 dedicated** gives a project its own Postgres and PostgREST when you need stronger physical separation.

The docs are ordered so you understand **what Flux is** and **why it is trustworthy** before you reach exhaustive CLI and environment reference.

## How this site is organized

| Path | Purpose |
|------|---------|
| [Introduction](/docs/introduction/what-is-flux) | Identity, philosophy, mental model |
| [Getting started](/docs/getting-started/installation) | Install CLI → project → first request → auth |
| [Concepts](/docs/concepts/projects) | Durable terms: projects, migrations, JWTs, RLS, engines, URLs |
| [Architecture](/docs/architecture/flux-v2) | How control plane, gateway, and data plane connect |
| [Security](/docs/security/authentication-model) | Trust boundaries, secrets, threat model |
| [Guides](/docs/guides/nextjs) | Opinionated app integration paths |
| [Examples](/docs/examples/simple-crud) | End-to-end narratives |
| [Reference](/docs/reference/cli) | CLI, env vars, config — after you have context |

## Core principles

1. **PostgreSQL-first** — Your schema and SQL are the source of truth.
2. **Migration-first** — Schema changes flow through migrations (`flux push` and friends).
3. **Coherent isolation** — Pooled and dedicated are explicit **deployment models** with honest tradeoffs, not marketing tiers alone.

## Minimal workflow

```bash
curl -sL https://flux.vsl-base.com/install | bash
export FLUX_API_BASE="https://flux.vsl-base.com/api"
export FLUX_API_TOKEN="flx_live_…"
flux login
flux create "my-app"
flux push ./schema.sql
```

Your app then calls the **Service URL** for the project (see [Service URLs](/docs/concepts/service-urls)) with the right auth model for your engine.

## Next steps

- New here: [What is Flux?](/docs/introduction/what-is-flux)
- Ready to install: [Installation](/docs/getting-started/installation)
- Reviewing security: [Authentication model](/docs/security/authentication-model)
