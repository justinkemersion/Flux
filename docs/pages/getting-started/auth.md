---
title: Authentication
description: Attach identity to Flux API calls—project JWTs at the gateway and Postgres roles inside the database.
---

# Authentication

Flux ties HTTP authentication to **PostgreSQL roles** and, when you enable it, **row-level security** policies. The edge story differs by engine: **v2 shared** centers on **gateway-validated JWTs**; **v1 dedicated** often uses static keys for PostgREST roles.

## What you will learn

- External **project JWT** vs internal **bridge JWT** (v2)
- Why `sub` (or equivalent) must match your RLS design
- Where to read secrets without leaking them to the browser

## The idea

1. Your IdP issues a **project JWT** your app sends to the **Service URL**.
2. On **v2**, the **gateway** verifies that token and mints a **bridge JWT** PostgREST trusts, with a **role** claim scoped to the tenant.
3. Postgres evaluates **GRANT**s first, then **RLS** policies for qualified roles.

If you skip the gateway in development and hit PostgREST directly, you must configure **PGRST_JWT_SECRET**-compatible tokens yourself and set schema headers—production traffic for v2 should not expose PostgREST publicly (see invariants in `docs/flux-v2-architecture.md`).

## How it works

- **HS256** with the project’s gateway/JWT secret is typical for PostgREST; your app’s IdP must issue something the gateway accepts, and policies should agree on identifier types (`text` `sub` vs UUID, etc.).
- **RLS** is not optional for security by itself—you still need correct **GRANT**s ([RLS](/docs/concepts/rls)).

## Example

Auth.js or Clerk guides show end-to-end wiring:

- [Auth.js + RLS](/docs/guides/authjs)
- [Clerk](/docs/guides/clerk)

Minimal pattern: mint or forward a token per request; never embed long-lived secrets in client bundles.

## Next steps

- [JWT authentication](/docs/concepts/jwt-auth)
- [Authentication model (security)](/docs/security/authentication-model)
