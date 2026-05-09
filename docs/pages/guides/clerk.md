---
title: Clerk with Flux
description: Clerk JWT templates and Flux v2 pooled stacks—browser and server fetch patterns.
section: guides
---

# Clerk with Flux

Clerk can issue JWTs your **Flux gateway** validates when templates and audiences are aligned.

## What you will learn

- Template-shaped `getToken({ template: "flux" })` pattern
- Why static “anon keys” do not replace gateway auth on v2
- Pointer to the integration guide

## The idea

Pooled stacks expect **Bearer** tokens from your IdP, not Supabase-style anonymous keys on the public internet. Configure Clerk (or your bridge) so tokens include the claims Flux expects—your host documentation or dashboard shows the exact secret alignment.

Canonical guide: `docs/guides/clerk-integration.md`.

## How it works

Browser:

```typescript
const token = await clerk.session?.getToken({ template: "flux" });
```

Server:

```typescript
const token = await clerk.session?.getToken({ template: "flux" });
// forward on server-side fetch to Flux
```

## Example

See also [First request](/docs/getting-started/first-request) for cURL and error semantics.

## Next steps

- [Authentication](/docs/getting-started/auth)
- [Authentication model](/docs/security/authentication-model)
