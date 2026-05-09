---
title: Next.js with Flux
description: Bootstrap a Next.js app against a Flux v2 shared project—URLs, env vars, fetch helper, and the smoke-test table.
section: guides
---

# Next.js with Flux

This guide bootstraps a brand-new Next.js app whose data API is a Flux **v2 shared** project. It is intentionally minimal: one fetch helper, one connectivity route, one tiny table. Add identity in [Auth.js with Flux](/docs/guides/authjs) or [Clerk with Flux](/docs/guides/clerk) once the platform plumbing is verified.

## What you will learn

- Which Flux values belong in `NEXT_PUBLIC_*` versus server-only env
- How the **Service URL** maps to a `fetch` base
- How to send the schema-negotiation headers PostgREST requires when the app talks to it directly
- How to verify connectivity before adding auth or RLS

## The idea

A Next.js app talks to Flux over HTTPS in one of two shapes:

- **Server routes** (App Router route handlers, server actions) hold any required JWTs and forward `Authorization: Bearer …` to the **Service URL**. Secrets stay out of the bundle.
- **Browser code** uses only short-lived tokens minted by the IdP for the current session. The browser never receives a long-lived gateway-equivalent secret.

Pooled (`v2_shared`) projects also expect requests to declare which **tenant schema** they target. The Flux gateway injects the right [`Accept-Profile` / `Content-Profile`](/docs/concepts/jwt-auth) header for you. Apps that talk to PostgREST **without** the gateway must send those headers themselves.

Tenant tables on v2 live in a per-tenant schema such as `t_5ecfa3ab72d1_api`—**not** `public`. The schema name is platform-issued; read it from `flux list`, the dashboard, or the gateway-injected profile headers.

## Prerequisites

- Node.js 20+
- A Flux project in `v2_shared` mode (CLI: `flux create my-app --mode v2_shared`)
- The Service URL for that project, in canonical flattened form: `https://api--<slug>--<hash>.<base-domain>`

## How it works

### 1) Create the app

```bash
npx create-next-app@latest flux-next-app --ts --eslint --app --src-dir --import-alias "@/*"
cd flux-next-app
```

### 2) Configure environment

`.env.local` separates the public Service URL (safe to embed in client bundles) from the tenant schema (server-only):

```bash
# Public: the Service URL the browser may call directly
NEXT_PUBLIC_FLUX_URL=https://api--<slug>--<hash>.vsl-base.com

# Server-only: the tenant schema PostgREST needs as Accept-Profile / Content-Profile
FLUX_POSTGREST_SCHEMA=t_5ecfa3ab72d1_api
```

Replace both placeholders with the values from `flux list` or the dashboard. Never put gateway signing secrets or static service-role keys in `NEXT_PUBLIC_*`.

### 3) Add a fetch helper

A single helper centralizes URL composition, schema headers, and (later) `Authorization`:

```ts
// src/lib/flux.ts
const profile = process.env.FLUX_POSTGREST_SCHEMA?.trim();

export async function fluxFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = process.env.NEXT_PUBLIC_FLUX_URL;
  if (!base) throw new Error("NEXT_PUBLIC_FLUX_URL is required");

  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");

  if (profile) {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" || method === "HEAD") headers.set("Accept-Profile", profile);
    else headers.set("Content-Profile", profile);
  }

  return fetch(url, { ...init, headers, cache: "no-store" });
}
```

The helper uses `cache: "no-store"` because Next.js otherwise caches `fetch` responses across requests in server components. That cache is rarely what API traffic wants.

### 4) Add a connectivity route

A route handler is the simplest place to verify everything end-to-end:

```ts
// src/app/api/health/route.ts
import { NextResponse } from "next/server";
import { fluxFetch } from "@/lib/flux";

export async function GET(): Promise<Response> {
  const res = await fluxFetch("/notes?select=*&limit=1");
  const body = await res.text();
  return NextResponse.json(
    { ok: res.ok, status: res.status, preview: body.slice(0, 300) },
    { status: res.ok ? 200 : 502 },
  );
}
```

### 5) Run and verify

```bash
npm run dev
```

Open `http://localhost:3000/api/health`. Expected outcomes:

- HTTP `200` with `ok: true` once a `notes` table exists in the tenant schema.
- A clear `4xx` or `5xx` payload with status text otherwise—useful for the next debugging step.

## Example

A minimal table to make the connectivity check meaningful. Save as `flux-init.sql` and qualify the schema for the tenant:

```sql
create table if not exists t_5ecfa3ab72d1_api.notes (
  id uuid primary key default gen_random_uuid(),
  body text not null,
  created_at timestamptz not null default now()
);

grant usage on schema t_5ecfa3ab72d1_api to authenticated;
grant select, insert, update, delete on table t_5ecfa3ab72d1_api.notes to authenticated;
```

Push it with the Flux CLI:

```bash
flux push ./flux-init.sql
```

A repo-root `flux.json` carrying `slug` and `hash` lets `flux push` resolve the project without `--project` / `--hash` on every call. See [CLI reference](/docs/reference/cli).

After the push, PostgREST reloads its schema cache. The `/api/health` route should now return rows (or an empty array, which is also a successful round-trip).

## Common pitfalls

| Symptom | Likely cause |
|---------|--------------|
| `404` from `/notes` | Wrong host, or the table lives in `public` instead of `t_<shortId>_api` |
| `42501` / `permission denied for schema` | Missing `GRANT USAGE ON SCHEMA … TO authenticated` |
| `401` once `Authorization` is added | Token signed with a different secret than the project expects |
| Stale results between requests | `fetch` cache not disabled (use `cache: "no-store"`) |
| TLS error from Node | Private CA not trusted in the runtime; see [Production hardening](/docs/guides/production-hardening) |

## Next steps

- [Auth.js with Flux](/docs/guides/authjs) — add per-user identity and RLS
- [Clerk with Flux](/docs/guides/clerk) — alternate identity provider with the same RLS shape
- [First request](/docs/getting-started/first-request) — protocol-level mental model
- [JWT authentication](/docs/concepts/jwt-auth) — what the gateway actually validates
