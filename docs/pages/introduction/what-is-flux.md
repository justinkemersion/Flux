---
title: What is Flux?
description: Flux as a PostgreSQL and REST backend platform—not only a database host or a dashboard.
section: introduction
---

# What is Flux?

**Flux** is a backend platform built around **PostgreSQL**, **PostgREST**, and a **control plane** that provisions and operates **projects**. A project is the deployable unit: database + API + routing + auth configuration—not “just a database” and not an ORM layer on top of someone else’s black box.

## What you will learn

- What category of system Flux is
- What a Flux **project** includes
- What Flux deliberately is not

## The idea

Operators and apps interact with Flux at three layers:

1. **Control plane** — CLI and dashboard create projects, run migrations, manage lifecycle, and store catalog state.
2. **Edge / gateway** — For **v2 shared**, the Flux gateway resolves the **Service URL**, validates **project JWTs**, and forwards to internal PostgREST with a **bridge JWT**.
3. **Data plane** — PostgreSQL holds data; PostgREST exposes your schema as HTTP resources.

Flux does not replace your understanding of SQL, HTTP, or JWTs. It **orchestrates** the pieces so each project is repeatable.

## How it works (at a glance)

| Piece | Role |
|-------|------|
| PostgreSQL | Durable data; optional **RLS** for row-level rules |
| PostgREST | REST mapping to your schemas |
| Control plane | Provisioning, migrations, secrets, routing metadata |
| Gateway (v2) | Public boundary: auth + tenant resolution + short-lived internal JWTs |

Engines (**v1 dedicated** vs **v2 shared**) change **how** resources are shared, not whether you get real Postgres and a real REST surface.

## Example

You define tables in SQL, apply with the CLI, and call JSON over HTTP:

```http
GET /items?select=*&limit=10
Authorization: Bearer <token>
```

The token story depends on engine—dedicated stacks often use project keys; pooled stacks use your app’s IdP JWT at the gateway.

## Next steps

- [Why Flux?](/docs/introduction/why-flux) — tradeoffs vs. other approaches
- [Mental model](/docs/introduction/mental-model) — request path and moving parts
