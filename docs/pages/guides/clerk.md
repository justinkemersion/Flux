---
title: Clerk with Flux
description: Use a Clerk JWT template to authenticate Flux v2 shared requests, with RLS keyed off the Clerk subject id.
section: guides
---

# Clerk with Flux

This guide wires Clerk-issued JWTs to a Flux **v2 shared** project. Clerk handles sign-in and token issuance; the Flux gateway validates those tokens with the project's JWT secret; RLS policies use Clerk's `sub` claim to scope rows. The pattern is the alternate identity provider for [Auth.js with Flux](/docs/guides/authjs)—the RLS shape is identical.

## What you will learn

- How to create a Clerk JWT template intended for Flux
- Where to paste the signing key in the Flux dashboard or CLI
- How to forward Clerk session JWTs from the browser or a server route
- How to write `auth.uid()`-style policies against Clerk's string `sub`

## The idea

Flux's gateway accepts JWTs signed with the project's **gateway secret** (HS256 by default). Clerk can issue tokens shaped exactly that way through a **JWT template**. Once the template's signing key matches the project secret, the gateway accepts Clerk session tokens with no extra translation:

```
browser  ──Bearer <clerk template JWT>──▶  Flux gateway
                                               │
                                               ▼
                                         PostgREST  ──▶  Postgres role + RLS
```

Pooled stacks deliberately have no anonymous public key. Every request is identified, even when the application surface looks like read-only marketing data.

## Prerequisites

- The connectivity smoke test from [Next.js with Flux](/docs/guides/nextjs) returns a 200.
- A Clerk application with at least one sign-in method enabled.
- Permission to read the project's **JWT secret** in the Flux dashboard (or via the CLI).

## How it works

### 1) Create a JWT template in Clerk

In the [Clerk dashboard](https://dashboard.clerk.com/), open the application and go to **Configure → JWT templates** (the path may vary across Clerk UI versions). Create a new template named `flux` (any name works; the application code references it by name).

Add the claims Flux expects:

```json
{
  "role": "authenticated",
  "sub": "{{user.id}}"
}
```

`role` selects the Postgres role PostgREST connects as. `sub` is whatever Clerk subject the application treats as the user identity—`user.id` is the most stable choice.

After saving the template, copy its **Signing key**. This is the symmetric secret used for HS256-style signing—not the Clerk *publishable* key.

### 2) Paste the secret into Flux

In the Flux dashboard, open **Project settings** for the relevant project, locate the **JWT secret / webhook secret** field, paste the Clerk signing key, and save. Flux updates `PGRST_JWT_SECRET` and recreates the API container so the new secret takes effect immediately.

The same value can be set non-interactively via the CLI; see [CLI reference](/docs/reference/cli).

After the secret rotates, the project's anon and service role keys (when present) are re-derived from it and change accordingly.

### 3) Forward Clerk tokens to Flux

From a Next.js route handler (server-side—no Clerk SDK in the bundle):

```ts
// src/app/api/my-posts/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { fluxFetch } from "@/lib/flux";

export async function GET(): Promise<Response> {
  const { userId, getToken } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const token = await getToken({ template: "flux" });
  if (!token) return NextResponse.json({ error: "no token" }, { status: 500 });

  const res = await fluxFetch(
    "/posts?select=id,title,user_id,created_at&order=created_at.desc",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return NextResponse.json(await res.json(), { status: res.status });
}
```

From the browser (only when the application accepts the trade-off of exposing the token to the page):

```ts
const token = await window.Clerk?.session?.getToken({ template: "flux" });
const res = await fetch(`${process.env.NEXT_PUBLIC_FLUX_URL}/posts?select=*`, {
  headers: { Authorization: `Bearer ${token}` },
});
```

`fluxFetch` from the [Next.js guide](/docs/guides/nextjs) handles the `Accept-Profile` / `Content-Profile` headers when the request bypasses the gateway.

### 4) RLS keyed off the Clerk `sub`

Clerk subjects are strings. RLS columns must therefore be `text`, not `uuid`. `auth.uid()` returns the JWT `sub` as `text` and matches the policy patterns familiar from Supabase:

```sql
create table if not exists t_5ecfa3ab72d1_api.posts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  title text not null,
  body text,
  created_at timestamptz not null default now()
);

alter table t_5ecfa3ab72d1_api.posts enable row level security;

create policy posts_owner_read
  on t_5ecfa3ab72d1_api.posts for select
  using (user_id = auth.uid());

create policy posts_owner_write
  on t_5ecfa3ab72d1_api.posts for insert
  with check (user_id = auth.uid());

grant usage on schema t_5ecfa3ab72d1_api to authenticated;
grant select, insert, update, delete on table t_5ecfa3ab72d1_api.posts to authenticated;
```

Push it:

```bash
flux push ./posts.sql
```

If existing tables use `uuid` for `user_id`, either alter the column to `text` or compare with `user_id::text = auth.uid()`. Long-term the `text` column is simpler.

`GRANT` is non-optional alongside RLS. RLS filters rows after the role is allowed to touch the table; without `GRANT`, the response is `403` / `42501`, not an empty array. See [RLS boundaries](/docs/security/rls-boundaries).

## Example

A first-touch profile pattern—create a row in `profiles` the first time the authenticated user calls the API. Useful when the application expects every signed-in user to have a profile row regardless of which feature they hit first:

```sql
create table if not exists t_5ecfa3ab72d1_api.profiles (
  id text primary key,
  updated_at timestamptz not null default now()
);

alter table t_5ecfa3ab72d1_api.profiles enable row level security;

create policy profiles_self_read
  on t_5ecfa3ab72d1_api.profiles for select
  using (id = auth.uid());

create or replace function t_5ecfa3ab72d1_api.ensure_user_profile()
returns void
language sql
security definer
set search_path = t_5ecfa3ab72d1_api, pg_temp
as $flux$
  insert into t_5ecfa3ab72d1_api.profiles (id, updated_at)
  values (auth.uid(), now())
  on conflict (id) do update set updated_at = excluded.updated_at;
$flux$;

revoke all on function t_5ecfa3ab72d1_api.ensure_user_profile() from public;
grant execute on function t_5ecfa3ab72d1_api.ensure_user_profile() to authenticated;
```

The application calls it once after sign-in:

```http
POST /rpc/ensure_user_profile
Authorization: Bearer <clerk template JWT>
```

`SECURITY DEFINER` is intentional: the function bypasses the policy on its own `INSERT` so the profile row exists before any RLS-sensitive read. The explicit `search_path` and the narrow `EXECUTE` grant keep the privilege escalation contained.

## Common pitfalls

| Symptom | Likely cause |
|---------|--------------|
| `401` from Flux | Template signing key does not match the project's JWT secret |
| `401` even after rotation | Old `PGRST_JWT_SECRET` cached in client; restart the container or re-fetch the secret |
| `42501` / `permission denied` | Missing `GRANT USAGE ON SCHEMA …` or per-table grants |
| Empty array for the signed-in user | `user_id` column is `uuid`; cast to `text` or alter the column |
| `request.jwt.claims` missing fields | Template did not include the claim—revisit step 1 |

## Next steps

- [Auth.js with Flux](/docs/guides/authjs) — equivalent flow with NextAuth
- [JWT authentication](/docs/concepts/jwt-auth) — claim contract and gateway flow
- [RLS boundaries](/docs/security/rls-boundaries) — what RLS does and does not protect
- [Authentication model](/docs/security/authentication-model) — security posture across engines
