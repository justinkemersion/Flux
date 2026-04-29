# Flux + Next.js + Auth.js (user-scoped RLS)

Purpose: extend the barebones pooled quickstart into authenticated, user-scoped access using Auth.js and `auth.uid()`-style policies.

Start here first:

- [`docs/guides/flux-nextjs-v2-shared-quickstart.md`](./flux-nextjs-v2-shared-quickstart.md)

---

## 1) Install Auth.js

From your Next.js project directory:

```bash
npm i next-auth
```

Set minimum env in `.env.local`:

```bash
cat >> .env.local <<'EOF'
AUTH_SECRET=replace-with-a-long-random-secret
AUTH_TRUST_HOST=true
EOF
```

---

## 2) Add Auth.js config

Create `src/auth.ts`:

```ts
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

Create `src/app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

> If you do not want GitHub, swap providers. The integration pattern stays the same.

---

## 3) Forward app user identity to Flux

For Flux RLS, user id columns should be `text`, and policies should compare against `auth.uid()`.

Create a secured route `src/app/api/my-notes/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";

function fluxUrl(path: string): string {
  const base = process.env.FLUX_SERVICE_URL;
  if (!base) throw new Error("FLUX_SERVICE_URL is required");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Replace this with your signed JWT path for Flux.
  // For early testing, use a server-issued test token env var if needed.
  const token = process.env.FLUX_BEARER_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "missing FLUX_BEARER_TOKEN" }, { status: 500 });
  }

  const res = await fetch(
    fluxUrl("/notes?select=id,body,owner_id,created_at&order=created_at.desc"),
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    },
  );

  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
```

---

## 4) Apply RLS-friendly schema in Flux

Create `flux-rls.sql`:

```sql
create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  body text not null,
  created_at timestamptz not null default now()
);

alter table notes enable row level security;

drop policy if exists notes_owner_read on notes;
create policy notes_owner_read
  on notes for select
  using (owner_id = auth.uid());

drop policy if exists notes_owner_insert on notes;
create policy notes_owner_insert
  on notes for insert
  with check (owner_id = auth.uid());

drop policy if exists notes_owner_update on notes;
create policy notes_owner_update
  on notes for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists notes_owner_delete on notes;
create policy notes_owner_delete
  on notes for delete
  using (owner_id = auth.uid());
```

Push it:

```bash
flux push ./flux-rls.sql -p my-pooled-app
```

---

## 5) Verification checklist

- Signed-out request to `/api/my-notes` returns `401`.
- Signed-in request returns only caller-owned rows.
- Insert with mismatched `owner_id` fails policy check.
- Two different test users cannot read each other’s rows.

---

## 6) Notes for pooled (`v2_shared`) testing

- Keep this test app intentionally small: one table, one route, one mutation path.
- Validate tenant isolation with a second pooled project before expanding scope.
- If auth claims do not map as expected in your current gateway setup, test platform plumbing first (public table read/write), then iterate identity propagation.

