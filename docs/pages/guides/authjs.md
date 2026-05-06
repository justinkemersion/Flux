---
title: Auth.js with Flux
description: Patterns for Next.js Auth.js sessions, JWTs, and Postgres RLS with Flux v2 shared.
---

# Auth.js with Flux

Auth.js (NextAuth v5) pairs naturally with Flux when your session strategy produces JWTs PostgREST accepts—or when your server routes mint per-request tokens using the same secret model as the gateway.

## What you will learn

- Why `AUTH_SECRET` matters
- How RLS-friendly `sub` claims line up with policies
- Where to read the full worked example

## The idea

Flux does not replace Auth.js; it **consumes** identity at the HTTP edge. Typical pitfalls:

- Missing `GRANT` alongside RLS policies
- `sub` type mismatch vs `user_id` columns
- Calling PostgREST without schema headers when bypassing the gateway in dev

## How it works

1. User signs in with Auth.js.
2. Server components or route handlers obtain a Flux-compatible JWT (or forward session-derived claims per your pattern).
3. Requests include `Authorization: Bearer …` to the **Service URL** (v2) or appropriate credentials (v1).

Canonical deep dive (this repo): `docs/guides/flux-nextjs-authjs-rls.md`.

## Example

Keep JWT signing secrets server-side; browsers should not hold long-lived gateway-equivalent keys.

## Next steps

- [JWT authentication](/docs/concepts/jwt-auth)
- [RLS boundaries](/docs/security/rls-boundaries)
- [Next.js quickstart](/docs/guides/nextjs)
