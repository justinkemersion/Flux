---
title: Bridge JWTs
description: Short-lived internal JWTs from the gateway to PostgREST on v2 shared.
section: architecture
---

# Bridge JWTs

A **bridge JWT** is minted by the **Flux gateway** after it validates your external **project JWT**. PostgREST trusts this internal token to select the correct **database role** and enforce schema visibility.

## What you will learn

- Why apps should not forge bridge tokens
- What claims typically matter downstream
- TTL and rotation expectations at a high level

## The idea

Apps never handle bridge secrets directly—the gateway holds signing material for the internal step. Your integration surface remains the IdP-issued token the gateway accepts.

Short TTLs limit exposure if a token were mis-issued; clients should refresh external tokens normally.

## How it works

```txt
Project JWT (IdP) → Gateway verifies → Bridge JWT (PostgREST) → Postgres role
```

Postgres then applies **GRANT**s and optional **RLS** under that role.

## Example

If PostgREST returns **401** with gateway in path, verify external JWT first; if **403**, suspect grants/RLS before blaming gateway routing.

## Next steps

- [JWT authentication](/docs/concepts/jwt-auth)
- [Project secrets](/docs/security/project-secrets)
