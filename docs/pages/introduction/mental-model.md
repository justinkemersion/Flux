---
title: Mental model
description: The main parts of Flux and how an HTTP request reaches your tenant schema.
section: introduction
---

# Mental model

Flux is easiest to reason about when you name four things: **application**, **gateway** (for v2), **PostgREST**, and **PostgreSQL**, plus the **control plane** that owns provisioning—not request-path hot code.

## What you will learn

- Canonical **request lifecycle** for v2 shared
- Where **tenant isolation** is enforced
- How this differs for v1 dedicated

## The idea

### Control plane vs data plane

- **Control plane** — Decides what exists: projects, engine, URLs, secrets, migrations. It talks to Docker and the catalog database (`flux-system` in this repo’s deployment shape).
- **Data plane** — Serves application traffic: Postgres + PostgREST (+ gateway on v2).

### Tenant boundary

For **v2 shared**, each tenant has a deterministic **schema** and **role** derived from an immutable `tenant_id` (see [Flux v2](/docs/architecture/flux-v2)). The **gateway** is the only issuer of short-lived **runtime JWTs** PostgREST trusts for pooled traffic.

For **v1 dedicated**, each project typically has its own Postgres and PostgREST containers; isolation is physical as well as logical.

## How it works — request lifecycle (v2)

Text-first diagram:

```txt
App
  → project JWT (from your IdP) on the Service URL
  → Flux Gateway (resolve tenant, verify external JWT)
  → Bridge JWT (role + tenant claims)
  → PostgREST (shared pool)
  → tenant schema in shared Postgres
```

For **v1**, the edge is often Traefik straight to tenant PostgREST with keys configured per project; there is no bridge JWT layer in the same form.

## Example

The mental model maps directly onto common failure shapes:

| Symptom | Layer that refused |
|---------|--------------------|
| `401` | Gateway — token missing, wrong secret, or invalid (SQL never ran) |
| `403` / `42501` | Postgres role — `GRANT` missing for the table or schema |
| Empty array | RLS — role allowed, no rows matched the policy |

Each row is documented in [Troubleshooting](/docs/reference/troubleshooting) with verification steps and the usual fix.

## Next steps

- [Request flow](/docs/architecture/request-flow)
- [Gateway](/docs/architecture/gateway)
- [Getting started: first request](/docs/getting-started/first-request)
- [Troubleshooting](/docs/reference/troubleshooting)
