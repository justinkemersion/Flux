---
title: Why Flux?
description: When Flux fits, and what tradeoffs you accept compared to hosted Postgres only, heavy BaaS, or DIY orchestration.
section: introduction
---

# Why Flux?

Flux exists for teams that want **real PostgreSQL**, **migration-first** workflows, and a **managed REST surface**—without adopting a monolithic BaaS that hides the database or locks you into a client SDK.

## What you will learn

- Problems Flux optimizes for
- Tradeoffs you should expect (especially on **v2 shared**)
- When **v1 dedicated** is the better fit

## The idea

### Compared to “only hosted Postgres”

You still own SQL and migrations. Flux adds **project isolation**, **API provisioning** (PostgREST), **routing** (Service URLs), and **auth integration** (gateway + JWT model on v2) so you are not wiring Traefik, containers, and reload signals by hand for every app.

### Compared to heavyweight BaaS

Flux does not try to be a full application platform. There is no proprietary row API you must use in the browser. The contract is **HTTP + Postgres + your policies**.

### Compared to DIY Docker Compose per app

Flux standardizes naming, networks, secrets, schema reload, and catalog metadata so **many** projects stay operable on one host or fleet.

## How it works — tradeoffs

| Choice | Benefit | Cost |
|--------|---------|------|
| **v2 shared** | Efficient use of cluster and gateway; good default for many apps | Shared cluster blast radius; gateway correctness is critical |
| **v1 dedicated** | Stronger physical isolation; predictable noisy-neighbor boundaries | More containers and resources per project |

Flux documents these differences plainly—see [Pooled vs dedicated](/docs/concepts/pooled-vs-dedicated) and [Threat model](/docs/security/threat-model).

## Example

If your team already versions schema in Git and wants every feature branch environment to map to a **project** with a stable **Service URL**, Flux matches how you think. If you need zero shared infrastructure and audited separation, you steer projects to **v1 dedicated** (or your org’s equivalent tier).

## Next steps

- [Mental model](/docs/introduction/mental-model)
- [Flux v2 shared](/docs/architecture/flux-v2) for the shared path in detail
