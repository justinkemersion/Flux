---
title: Project secrets
description: Gateway secrets, JWT signing material, and rotation without accidental exposure.
section: security
---

# Project secrets

**Project secrets** are the keys and tokens that authenticate control-plane actions or sign/verify JWTs at the edge. They must never be committed to application repos or shipped in browser bundles.

## What you will learn

- What kinds of secrets exist (CLI vs gateway vs database)
- Rotation mindset
- Where dashboard vs CLI surfaces secrets

## The idea

- **CLI** uses personal **API tokens** (`FLUX_API_TOKEN`) for control plane HTTP—not for end-user row access.
- **Gateway / PostgREST** use **HS256**-style shared secrets for JWT verification in typical setups; exact names vary by deployment (`PGRST_JWT_SECRET`, gateway signing keys, etc.).

Exposure of gateway/PostgREST secrets allows token forgery at the data plane—treat rotation as a security incident if leaked.

## How it works

Rotation checklist (high level):

1. Generate new secret material in a secure path.
2. Update gateway and PostgREST configuration consistently.
3. Roll clients/IdP issuers if they embed old assumptions.
4. Invalidate old material after cutover.

Never rely on `NODE_TLS_REJECT_UNAUTHORIZED=0` globally to paper over TLS issues—scope trust fixes (`NODE_EXTRA_CA_CERTS`).

## Example

Store `NEXT_PUBLIC_*` only for **non-secret** URLs. Keep signing keys server-side.

## Next steps

- [Authentication model](/docs/security/authentication-model)
- [Environment variables](/docs/reference/env-vars)
