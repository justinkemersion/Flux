# Flux + Next.js (`v2_shared`) quickstart

Purpose: bootstrap a brand-new Next.js app that uses a Flux pooled (`v2_shared`) project as its data API spine.

This guide is intentionally minimal and copy/paste friendly.

**Before you copy/paste:** read the repo root **[`AGENTS.md`](../../AGENTS.md)** — it lists v2_shared footguns (API hostname, tenant schema, PostgREST profile headers, JWT + `GRANT`, TLS from Node) that cause **404 / 403 / 42501** and burn hours if missed.

---

## 0) Prerequisites

- Node.js 20+
- npm
- Flux account with a project in `v2_shared` mode
- Flux **PostgREST** base URL for that project (see **hostname** notes below)

### Hostname: canonical flattened URL (and legacy dotted)

The dashboard / `flux list` show the **canonical** tenant API base:

`https://api--<slug>--<hash>.<domain>`

Older material may still reference the **legacy** dotted dedicated host:

`https://api.<slug>.<hash>.<domain>`

Dedicated v1 stacks accept both; pooled `v2_shared` traffic uses the flattened host at the gateway. Verify with `curl -sS -o /dev/null -w "%{http_code}" "https://…/notes"` (**200** or **401** means routed; **404** means wrong host or path).

### Tenant API schema (`t_<shortId>_api`)

v2_shared stores tenant tables in a per-tenant schema such as `t_5ecfa3ab72d1_api`, **not** `public`. Your SQL must create objects **in that schema**, and HTTP clients that talk **directly** to PostgREST must send **`Accept-Profile`** / **`Content-Profile`** for that schema unless you go through the Flux gateway (which injects them — see main [`README.md`](../../README.md) *JWT and schema isolation handshake*).

If you prefer CLI provisioning, create a pooled project first:

```bash
flux create my-pooled-app --mode v2_shared
```

Then copy the working API base URL from `flux list`, the dashboard, or `curl` probing as above. Add a repo-root **`flux.json`** with `"slug"` / `"hash"` so `flux push ./file.sql` does not need `-p` / `--hash` every time.

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
# PostgREST origin (no trailing /rest/v1). Use triple-dash host if short URL 404s on /tablename.
FLUX_SERVICE_URL=https://api--<slug>--<hash>.vsl-base.com
# Required for direct PostgREST fetch: same schema PostgREST uses for your tenant (see AGENTS.md).
FLUX_POSTGREST_SCHEMA=t_<shortId>_api
EOF
```

Replace `t_<shortId>_api` with the real schema name for your tenant (Postgres error text, operator docs, or the profile headers the gateway would send).

---

## 3) Add a small Flux fetch helper

Create `src/lib/flux.ts`:

```ts
const profile = process.env.FLUX_POSTGREST_SCHEMA?.trim();

export async function fluxFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = process.env.FLUX_SERVICE_URL;
  if (!base) throw new Error("FLUX_SERVICE_URL is required");

  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  if (profile) {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" || method === "HEAD") headers.set("Accept-Profile", profile);
    if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
      headers.set("Content-Profile", profile);
    }
  }

  return fetch(url, {
    ...init,
    headers,
    cache: "no-store",
  });
}
```

Add **Authorization: Bearer &lt;JWT&gt;** in the same helper once you mint HS256 tokens with the tenant’s gateway secret (`PGRST_JWT_SECRET` / dashboard). Policies need matching **`GRANT`** on the schema and tables, not only RLS — see [`AGENTS.md`](../../AGENTS.md).

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

Create `flux-init.sql` in your Next.js project. **Qualify the schema** for v2_shared (replace `t_<shortId>_api` with your tenant API schema):

```bash
cat > flux-init.sql <<'EOF'
create table if not exists t_<shortId>_api.notes (
  id uuid primary key default gen_random_uuid(),
  body text not null,
  created_at timestamptz not null default now()
);

grant usage on schema t_<shortId>_api to authenticated;
grant select, insert, update, delete on table t_<shortId>_api.notes to authenticated;
EOF
```

Apply it to your project:

```bash
flux push ./flux-init.sql
```

(with `flux.json` containing `"slug": "my-pooled-app"`, or pass `-p my-pooled-app` / `--hash` as documented in `flux push --help`).

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

