---
title: Tenant isolation (security)
description: Guarantees, blast radius, and honest limits of pooled vs dedicated engines.
section: security
---

# Tenant isolation (security)

Structural layout lives under [Tenant isolation (architecture)](/docs/architecture/tenant-isolation). This page states **what you are protected from** and **what remains your responsibility**.

## What you will learn

- Pooled **soft isolation** tradeoffs
- Why gateway correctness is a single point of failure for cross-tenant safety on v2
- When dedicated infrastructure is appropriate

## The idea

**v2 shared** relies on:

- Correct **tenant resolution** and JWT issuance at the gateway
- Postgres **role** boundaries preventing cross-schema access
- Operational controls (limits, timeouts, rate limits) for noisy neighbors

A bug that puts tenant A’s data in tenant B’s role is a **critical** incident class—there is no RLS safety net unless you added policies yourself.

**v1 dedicated** reduces shared-cluster risk by isolating processes and disks per project—at higher cost.

## How it works

Free/Pro-style pooled tiers accept **cluster-level blast radius** by design (see the [v2 architecture specification](/docs/architecture/flux-v2-architecture)). Mitigations are operational and architectural, not “magic”.

## Example

Compliance regimes requiring physically separate databases should default to **v1 dedicated** or equivalent—not pooled shared clusters.

## Next steps

- [Threat model](/docs/security/threat-model)
- [Pooled vs dedicated](/docs/concepts/pooled-vs-dedicated)
