---
title: Threat model
description: In-scope attacks, primary controls, and explicit non-promises for Flux v2 shared.
---

# Threat model

This page summarizes the **v2 shared** stance in plain language. Authoritative detail: `docs/flux-v2-architecture.md` in this repository.

## What you will learn

- Primary security chain
- Top risk: JWT mis-issuance
- What is explicitly **not** promised on pooled tiers

## The idea

### Primary chain

```txt
Gateway → bridge JWT → PostgREST → tenant schema role
```

If the gateway maps the wrong tenant or role, Postgres cannot automatically “fix” that at row level unless you added RLS yourself.

### Top risk

**Incorrect `role` or `tenant_id` in a gateway-issued JWT** enables cross-tenant access. Defenses are **correct code**, **tests**, **short TTLs**, and **operational monitoring**—not marketing language.

### Not promised (examples)

- RLS on by default for every table on v2
- Hard CPU isolation per tenant on shared clusters
- Protection from compromised IdP signing keys (your identity system remains in scope)

## How it works

Operational mitigations: rate limits, connection limits, `statement_timeout`, horizontal scaling of clusters when hot.

## Example

A security review should read gateway resolution code paths and host parsing tests (e.g. flattened vs legacy hostnames) alongside Postgres grants.

## Next steps

- [Flux v2 shared](/docs/architecture/flux-v2)
- [Production hardening](/docs/guides/production-hardening)
