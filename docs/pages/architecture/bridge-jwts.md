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

**Project JWT contract (v2_shared):** Mint HS256 tokens with your per-project `jwt_secret`. Include a stable **`sub`** for RLS. The inbound **`role`** claim may be `authenticated` (Foundry / Supabase style); the gateway **does not forward** that claim. After verification it mints a bridge JWT whose **`role`** is always **`t_<shortId>_role`** (same short id as `t_<shortId>_api`), plus **`tenant_id`** and the preserved **`sub`**.

The behavior above is versioned as **`FLUX_GATEWAY_CONTRACT_VERSION`** (currently `1.0.0`), exported from `@flux/gateway` alongside `FLUX_GATEWAY_CONTRACT_INVARIANTS`. Downstream doctor tooling can assert against it instead of hard-coding strings.

Short TTLs limit exposure if a token were mis-issued; clients should refresh external tokens normally.

## How it works

```txt
Project JWT (IdP) → Gateway verifies → Bridge JWT (PostgREST) → Postgres role
```

Postgres then applies **GRANT**s and optional **RLS** under that role.

## Example

The bridge boundary explains the `401` vs `403` split: `401` with `{ "error": "authorization required" }` means the gateway resolved the tenant host but refused the request before minting a bridge JWT (missing/empty/invalid project Bearer). This is the expected response for unauthenticated access to protected resources such as `GET /rest/v1/profiles`. `403` means the bridge JWT was minted and the request reached PostgreSQL, where the role lacked `GRANT` (RLS would have returned an empty array, not an error). [Troubleshooting](/docs/reference/troubleshooting) walks both cases with verification steps.

## Next steps

- [JWT authentication](/docs/concepts/jwt-auth)
- [Project secrets](/docs/security/project-secrets)
- [Troubleshooting](/docs/reference/troubleshooting)
