---
title: Production hardening
description: Operational and security practices for running Flux-backed apps in production.
---

# Production hardening

Production is where implicit assumptions break: TLS trust, secret rotation, rate limits, and observability.

## What you will learn

- TLS and CA trust patterns for Node clients
- Why gateway and DB limits matter on shared clusters
- Pointers to internal ops docs

## The idea

- Prefer **`NODE_EXTRA_CA_CERTS`** (or system trust) over disabling TLS verification globally.
- On **v2**, internal probes should often target the **gateway** with correct `Host` headers—see `README.md` (`FLUX_TENANT_PROBE_GATEWAY_URL`).
- Treat gateway signing keys like database superuser passwords: rotation plans, access logging, least privilege.

## How it works

Review:

- `docs/production-security-audit.md` — audit framing
- `docs/OPERATIONS.md` — operational checklist items relevant to your deployment

Self-hosted **control plane** (`flux-web`): **`flux migrate`** runs **`pg_dump` inside the dashboard container** against the shared cluster. The **`apps/dashboard/Dockerfile`** runner image must include PostgreSQL client tools (see repo Dockerfile); restarting an old image without rebuilding leaves **`pg_dump` missing** at runtime. Operator flow: [Pooled → dedicated migrate](/docs/guides/v2-to-v1-migrate).

## Example

For multi-region or multi-cluster, document **which** Postgres cluster holds a tenant before running destructive maintenance.

## Next steps

- [Threat model](/docs/security/threat-model)
- [Environment variables](/docs/reference/env-vars)
- [Pooled → dedicated migrate](/docs/guides/v2-to-v1-migrate)
