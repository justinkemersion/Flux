---
title: JWT authentication
description: Project JWTs, gateway verification, bridge JWTs, and PostgREST roles.
---

# JWT authentication

On **v2 shared**, your application presents a **project JWT** (from your IdP) to the **Service URL**. The **Flux gateway** verifies it and mints a **bridge JWT** that PostgREST uses to connect as a **tenant-scoped role**.

## What you will learn

- External vs internal tokens
- Typical claims (`role`, `sub`, …)
- Headers when calling PostgREST without the gateway

## The idea

PostgREST trusts JWTs signed with the project’s configured secret (see `PGRST_JWT_SECRET` in architecture docs). The gateway centralizes verification so browsers never receive long-lived database-equivalent secrets for pooled projects.

**`sub`** (or the claim your policies use) must match the column types and predicates in **RLS** if you enable it.

## How it works

1. User authenticates with your IdP.
2. App requests a JWT suitable for Flux (template / custom claims as configured).
3. App calls `Authorization: Bearer …` on the Service URL.
4. Gateway → bridge JWT → PostgREST → Postgres role.

### Direct PostgREST (advanced)

If you must skip the gateway temporarily, send:

| Operation | Header |
|-----------|--------|
| GET / HEAD | `Accept-Profile: <tenant_schema>` |
| Mutations | `Content-Profile: <tenant_schema>` |

See PostgREST schema docs and [Service URLs](/docs/concepts/service-urls) (profiles when bypassing the gateway).

## Example

Conceptual claims:

```json
{
  "role": "authenticated",
  "sub": "user_01HZZZZZZZ"
}
```

Exact role names depend on your engine and bootstrap SQL.

## Next steps

- [Bridge JWTs](/docs/architecture/bridge-jwts)
- [Authentication model](/docs/security/authentication-model)
