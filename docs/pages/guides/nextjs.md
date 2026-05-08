---
title: Next.js with Flux
description: Bootstrap a Next.js app against a Flux v2 shared project—URLs, env vars, and common pitfalls.
---

# Next.js with Flux

Next.js is a common control plane for **server** calls (no secrets in the bundle) and **client** calls (short-lived tokens only).

## What you will learn

- Which values belong in `NEXT_PUBLIC_*` vs server env
- How Service URLs map to `fetch` bases
- Link to the maintained quickstart

## The idea

- Put **only** the public Service URL in `NEXT_PUBLIC_FLUX_URL` if the browser must call Flux directly.
- Never expose gateway signing secrets or static service-role keys meant for backends.
- For v2, prefer server routes that attach `Authorization` using your IdP’s session.

Canonical quickstart: `docs/guides/flux-nextjs-v2-shared-quickstart.md`.

## How it works

```bash
NEXT_PUBLIC_FLUX_URL=https://api--myapp--abc123d.example.com
```

Server-only:

```bash
FLUX_URL=https://api--myapp--abc123d.example.com
```

Use `flux list` / dashboard for the exact host.

## Example

```typescript
// Route handler (illustrative)
const res = await fetch(`${process.env.FLUX_URL}/items?select=*`, {
  headers: { Authorization: `Bearer ${token}` },
  cache: "no-store",
});
```

## Next steps

- [First request](/docs/getting-started/first-request)
- [Auth.js guide](/docs/guides/authjs)
- [Production hardening](/docs/guides/production-hardening) (TLS trust from Node)
- [JWT authentication](/docs/concepts/jwt-auth) (profile headers for direct PostgREST)
