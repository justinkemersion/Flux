# Flux + Next.js (`v2_shared`) quickstart

Purpose: bootstrap a brand-new Next.js app that uses a Flux pooled (`v2_shared`) project as its data API spine.

This guide is intentionally minimal and copy/paste friendly.

---

## 0) Prerequisites

- Node.js 20+
- npm
- Flux account with a project in `v2_shared` mode
- Flux service URL for that project (example: `https://api.<slug>.<hash>.vsl-base.com`)

If you prefer CLI provisioning, create a pooled project first:

```bash
flux create my-pooled-app --mode v2_shared
```

Then copy the service URL from `flux list` or the dashboard project card.

---

## 1) Create a fresh Next.js app

```bash
npx create-next-app@latest flux-next-barebones --ts --eslint --app --src-dir --import-alias "@/*"
cd flux-next-barebones
```

Everything below runs from this project directory.

---

## 2) Configure environment

Create `.env.local`:

```bash
cat > .env.local <<'EOF'
FLUX_SERVICE_URL=https://api.<slug>.<hash>.vsl-base.com
EOF
```

Use the Flux API service URL exactly (no trailing `/rest/v1`).

---

## 3) Add a small Flux fetch helper

Create `src/lib/flux.ts`:

```ts
export async function fluxFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = process.env.FLUX_SERVICE_URL;
  if (!base) throw new Error("FLUX_SERVICE_URL is required");

  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");

  return fetch(url, {
    ...init,
    headers,
    cache: "no-store",
  });
}
```

---

## 4) Add an API connectivity route

Create `src/app/api/health/route.ts`:

```ts
import { NextResponse } from "next/server";
import { fluxFetch } from "@/lib/flux";

export async function GET(): Promise<Response> {
  const res = await fluxFetch("/hops?select=*&limit=1");
  const body = await res.text();

  return NextResponse.json(
    {
      ok: res.ok,
      status: res.status,
      preview: body.slice(0, 300),
    },
    { status: res.ok ? 200 : 502 },
  );
}
```

---

## 5) Run and verify

```bash
npm run dev
```

Open:

- `http://localhost:3000/api/health`

Expected:

- HTTP `200` with `ok: true`, or
- a clear auth/policy error payload from Flux (useful for next-step debugging).

---

## 6) Add a tiny test table in Flux

Create `flux-init.sql` in your Next.js project:

```bash
cat > flux-init.sql <<'EOF'
create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  body text not null,
  created_at timestamptz not null default now()
);
EOF
```

Apply it to your project:

```bash
flux push ./flux-init.sql -p my-pooled-app
```

---

## 7) Add a notes route (read/write smoke test)

Create `src/app/api/notes/route.ts`:

```ts
import { NextResponse } from "next/server";
import { fluxFetch } from "@/lib/flux";

export async function GET(): Promise<Response> {
  const res = await fluxFetch("/notes?select=*&order=created_at.desc&limit=20");
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}

export async function POST(req: Request): Promise<Response> {
  const { body } = (await req.json()) as { body?: string };
  if (!body?.trim()) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }

  const res = await fluxFetch("/notes", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{ body: body.trim() }]),
  });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
```

Quick test:

```bash
curl -sS http://localhost:3000/api/notes
curl -sS -X POST http://localhost:3000/api/notes -H "content-type: application/json" -d '{"body":"hello flux"}'
curl -sS http://localhost:3000/api/notes
```

---

## 8) Recommended next step

Add real user auth and per-user RLS policies:

- [`docs/guides/flux-nextjs-authjs-rls.md`](./flux-nextjs-authjs-rls.md)

