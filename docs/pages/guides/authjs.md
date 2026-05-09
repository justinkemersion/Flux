---
title: Auth.js with Flux
description: Add Auth.js sessions and per-user RLS to a Next.js app talking to a Flux v2 shared project.
section: guides
---

# Auth.js with Flux

This guide adds user identity to the bare connectivity from [Next.js with Flux](/docs/guides/nextjs). Auth.js (NextAuth v5) handles the sign-in flow; Flux consumes the resulting JWT at the gateway and enforces per-user access through Postgres **row-level security**.

## What you will learn

- Why `AUTH_SECRET` matters and how it interacts with Flux secrets
- How to forward an Auth.js identity into a Flux request
- How to write `auth.uid()`-style RLS policies that match Auth.js subject ids
- How to verify isolation between two test users

## The idea

Flux does not replace Auth.js—it consumes identity at the HTTP edge. The request flow stays simple:

1. The user signs in through Auth.js.
2. A server route obtains a Flux-compatible JWT and attaches it to outbound `fetch` calls.
3. The Flux gateway validates the token and runs the underlying SQL as the Postgres role named by the `role` claim.
4. RLS policies compare the JWT `sub` claim against the row's `user_id` and decide what the role can see.

`sub` must match the Postgres column type. Auth.js issues string subjects (provider account ids, e-mails), so RLS columns should be `text`, not `uuid`. See [JWT authentication](/docs/concepts/jwt-auth) for the full claim contract.

## Prerequisites

- The connectivity smoke test from [Next.js with Flux](/docs/guides/nextjs) returns a 200.
- The tenant schema name (e.g. `t_5ecfa3ab72d1_api`) is known and saved in `FLUX_POSTGREST_SCHEMA`.
- The project's gateway secret is available—see the project's **JWT secret** in the dashboard.

## How it works

### 1) Install Auth.js

```bash
npm install next-auth
```

Add the minimum env to `.env.local`:

```bash
AUTH_SECRET=<long-random-string>
AUTH_TRUST_HOST=true
```

A missing `AUTH_SECRET` breaks `/api/auth/session` silently. Rotating it invalidates existing session cookies until browsers clear them; expect one `JWTSessionError` per browser during a rotation.

### 2) Configure providers

```ts
// src/auth.ts
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

export const { handlers, auth } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID ?? "",
      clientSecret: process.env.AUTH_GITHUB_SECRET ?? "",
    }),
  ],
});
```

```ts
// src/app/api/auth/[...nextauth]/route.ts
import { handlers } from "@/auth";
export const { GET, POST } = handlers;
```

GitHub is one example; the integration shape is identical for any Auth.js provider.

### 3) Mint a Flux-compatible token server-side

Auth.js sessions and Flux JWTs are different things. The session proves who the user is to the Next.js app. A Flux JWT proves that identity to the Flux gateway, signed with the **project JWT secret** (HS256). Mint it server-side using the user's stable subject id:

```ts
// src/lib/flux-token.ts
import { SignJWT } from "jose";

const secret = new TextEncoder().encode(process.env.FLUX_JWT_SECRET);

export async function mintFluxToken(sub: string): Promise<string> {
  return await new SignJWT({ role: "authenticated", sub })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);
}
```

`FLUX_JWT_SECRET` is the project's gateway/PostgREST secret. It belongs only on the server. Token lifetimes should be short—five minutes is a reasonable default for backend-to-backend calls.

### 4) Attach the token to a Flux request

Reuse `fluxFetch` from the Next.js guide and a session-aware route:

```ts
// src/app/api/my-notes/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { fluxFetch } from "@/lib/flux";
import { mintFluxToken } from "@/lib/flux-token";

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = await mintFluxToken(session.user.email);

  const res = await fluxFetch(
    "/notes?select=id,body,owner_id,created_at&order=created_at.desc",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return NextResponse.json(await res.json(), { status: res.status });
}
```

Pick a stable subject. Provider account ids are more stable than e-mail; switch the `sub` to whichever value the application treats as the canonical user identity.

### 5) Apply an RLS-friendly schema

Save as `flux-rls.sql`, qualify the schema for the tenant:

```sql
create table if not exists t_5ecfa3ab72d1_api.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  body text not null,
  created_at timestamptz not null default now()
);

alter table t_5ecfa3ab72d1_api.notes enable row level security;

create policy notes_owner_read
  on t_5ecfa3ab72d1_api.notes for select
  using (owner_id = auth.uid());

create policy notes_owner_insert
  on t_5ecfa3ab72d1_api.notes for insert
  with check (owner_id = auth.uid());

create policy notes_owner_update
  on t_5ecfa3ab72d1_api.notes for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy notes_owner_delete
  on t_5ecfa3ab72d1_api.notes for delete
  using (owner_id = auth.uid());

grant usage on schema t_5ecfa3ab72d1_api to authenticated;
grant select, insert, update, delete on table t_5ecfa3ab72d1_api.notes to authenticated;
```

Push it:

```bash
flux push ./flux-rls.sql
```

`auth.uid()` is a Flux-provided helper that returns the JWT `sub` claim cast to `text`. It mirrors the Supabase-style policy shape so existing patterns translate directly.

`GRANT` is not optional. RLS filters rows **after** the database role is allowed to touch the table; without `GRANT`, PostgREST returns `403` / `42501`, not an empty array. See [RLS boundaries](/docs/security/rls-boundaries).

## Example

A minimal verification flow once everything is wired:

```bash
# Signed-out request
curl -i http://localhost:3000/api/my-notes
# Expect: 401

# Signed-in request (after sign-in via /api/auth/signin/github)
curl -i --cookie "next-auth.session-token=…" http://localhost:3000/api/my-notes
# Expect: 200, returning only rows where owner_id matches the caller

# Insert with a forged owner_id (do not do this in production)
# Expect the policy to reject it, returning 403 / 42501.
```

## Verification checklist

- A signed-out request to the protected route returns `401`.
- A signed-in request returns only rows whose `owner_id` equals the session subject.
- An insert with a mismatched `owner_id` fails the `WITH CHECK` clause.
- Two different test users cannot read each other's rows.

## Common pitfalls

| Symptom | Likely cause |
|---------|--------------|
| `JWTSessionError` in logs | `AUTH_SECRET` rotated; clear cookies in the browser |
| Empty array for the signed-in user | `sub` does not match `owner_id`—type or value mismatch |
| `42501` on insert | Missing `GRANT` on schema or table |
| `401` from Flux despite a valid session | Token signed with the wrong secret, or `role` claim missing |

## Next steps

- [RLS boundaries](/docs/security/rls-boundaries) — what RLS does and does not protect
- [JWT authentication](/docs/concepts/jwt-auth) — claim contract and gateway flow
- [Clerk with Flux](/docs/guides/clerk) — same RLS shape with a different identity provider
- [Authentication model](/docs/security/authentication-model) — full security posture
