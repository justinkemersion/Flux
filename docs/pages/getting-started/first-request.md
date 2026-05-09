---
title: First request
description: Make a successful HTTP call to your project API on v1 dedicated or v2 shared.
section: getting-started
---

# First request

This page gets you from “project exists” to “HTTP returns expected JSON”. The details depend on your **engine**: **v1 dedicated** often uses project API keys; **v2 shared** uses your app’s IdP-issued JWT against the **Service URL** and the **gateway**.

## What you will learn

- How v1 and v2 differ at the edge
- A minimal fetch example for **v2 shared** (Clerk-shaped)
- Where to debug 401 vs 403

## The idea

- **v1 dedicated** — PostgREST may be reachable via Traefik with `anon` / `service` style keys depending on your setup. Consult the credentials your project printed at provision time.
- **v2 shared** — There is no anonymous public key in the Supabase sense. The **Flux gateway** validates a **project JWT** from your auth provider, then mints a short-lived **bridge JWT** for PostgREST.

Deep architecture: [Gateway](/docs/architecture/gateway), [Bridge JWTs](/docs/architecture/bridge-jwts).

## How it works (v2 shared)

1. Pick your **Service URL** (from `flux list` or the dashboard). Canonical external form is often:

   `https://api--<slug>--<hash>.<base-domain>`

2. Obtain a JWT from your provider (Clerk template, Auth.js session strategy, etc.) that the gateway accepts.

3. Call PostgREST paths relative to that origin:

```http
GET /your_table?select=*&limit=10
Authorization: Bearer <project-jwt>
```

If you bypass the gateway and talk to PostgREST directly in dev, you must send schema negotiation headers (`Accept-Profile` / `Content-Profile`)—see [JWT authentication](/docs/concepts/jwt-auth) and [Next.js](/docs/guides/nextjs) (server vs client patterns).

### Query parameters from the dashboard

If you opened this page from the dashboard “Pooled stack” helper, your **`slug`** and **`hash`** may appear in the query string so you can paste a URL into examples.

## Example (browser-style, Clerk)

```typescript
const token = await window.Clerk?.session?.getToken({ template: "flux" });
const res = await fetch(`${process.env.NEXT_PUBLIC_FLUX_URL}/notes?select=*&limit=10`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!res.ok) throw new Error(`Flux request failed: ${res.status}`);
const data = await res.json();
```

Replace `notes` with your table. Use environment variables instead of hard-coding URLs.

### cURL

```bash
curl "https://api--<slug>--<hash>.example.com/notes?select=*&limit=5" \
  -H "Authorization: Bearer <token>"
```

## Common errors

| Symptom | Likely cause | Canonical entry |
|---------|--------------|-----------------|
| `401` | Missing/expired token, wrong template/audience | [401 Unauthorized](/docs/reference/troubleshooting#401-unauthorized) |
| `403` / `42501` | Missing `GRANT` (`42501`) or RLS policy blocking role | [403 Forbidden](/docs/reference/troubleshooting#403-forbidden) · [42501](/docs/reference/troubleshooting#42501-permission-denied) |
| Empty array | RLS filtered, type mismatch in policy, or simply no rows | [Empty array](/docs/reference/troubleshooting#empty-array-instead-of-an-error) |

## Next steps

- [Authentication](/docs/getting-started/auth)
- [Clerk guide](/docs/guides/clerk) or [Auth.js guide](/docs/guides/authjs)
- [Troubleshooting](/docs/reference/troubleshooting)
