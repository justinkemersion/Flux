---
title: Authentication model
description: Who verifies which token, what can go wrong, and what Flux does not promise.
section: security
---

# Authentication model

Flux separates **external identity** (your IdP’s **project JWT**) from **internal execution** (PostgREST’s database **role**) on **v2 shared**. The **gateway** is the trust pivot: it is the component that must correctly map host → tenant and claims → role.

## What you will learn

- Verification boundaries
- Rotation and compromise surface at a high level
- Relationship to [JWT authentication](/docs/concepts/jwt-auth) (product) vs this page (trust)

## The idea

| Token | Verified by | Purpose |
|-------|-------------|---------|
| Project JWT | Gateway (per project rules) | Proves user/app identity to Flux edge |
| Bridge JWT | PostgREST / Postgres config | Binds connection to tenant role |

Forgery of bridge JWTs without gateway keys should be infeasible; forgery of project JWTs is your IdP’s problem—but the gateway must **reject** invalid tokens every time.

## How it works

- Short TTL on bridge JWTs limits blast radius of mis-issuance.
- Clock skew, wrong audience, and template mismatch surface as **401**s at the edge.

## Example

Rotating **PGRST_JWT_SECRET** / gateway signing material requires coordinated rollout—plan maintenance windows and validate both edge and PostgREST agree.

## Next steps

- [Project secrets](/docs/security/project-secrets)
- [Bridge JWTs](/docs/architecture/bridge-jwts)
