# Flux v2_shared First-Project Quickstart

Purpose: explain how a first-time user connects to a pooled (`v2_shared`) project when there are no static anon/service keys shown in the dashboard.

---

## Mental model (v1 vs v2)

- `v1_dedicated`:
  - dedicated Postgres + PostgREST containers per project
  - dashboard can expose per-project anon/service-style credentials
- `v2_shared`:
  - shared PostgREST + shared Postgres cluster, schema-per-tenant
  - connect via **Service URL + app auth token flow**
  - no static per-project Docker credentials exposed in dashboard

---

## 1) What to copy from the dashboard

For the v2 project card, copy only:

- **Service URL** (example): `https://api.cli-e2e-smoke-1777421626.4f9aeaa.vsl-base.com`

That URL is the base for PostgREST requests.

---

## 2) Signed-in browser flow (recommended)

Use your auth provider (e.g. Clerk) to get a user token and send it as `Authorization: Bearer ...`.

Example pattern:

```ts
const token = await window.Clerk?.session?.getToken({ template: "flux" });

const res = await fetch(
  "https://api.<slug>.<hash>.vsl-base.com/hops?select=*&limit=20",
  {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  },
);
```

If signed out, the request may be denied depending on gateway/RLS policy.

---

## 3) Server-side flow (Next.js route/server action)

Server gets a user token from auth middleware and forwards it.

```ts
const token = await getTokenFromYourAuthLayer(); // e.g. Clerk template "flux"

const res = await fetch(
  `${process.env.FLUX_SERVICE_URL}/recipes?select=*&limit=50`,
  {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  },
);
```

---

## 4) Quick cURL test

Use a real user token issued by your auth provider:

```bash
curl -sS "https://api.<slug>.<hash>.vsl-base.com/hops?select=id,name&limit=5" \
  -H "Authorization: Bearer <USER_TOKEN>"
```

If the token is valid and policies allow reads, JSON rows return.

---

## 5) Common failure modes

- `401/403`:
  - missing token
  - wrong auth template/token audience/issuer
  - token expired
- Works signed-in, fails signed-out:
  - expected for protected routes/tables
- Unexpected empty rows:
  - check tenant schema data loaded
  - check RLS/policies for authenticated role

---

## 6) Product copy recommendation (dashboard)

For v2 cards, replace key placeholders with explicit guidance:

- "Pooled project: static anon/service keys are not exposed."
- "Use Service URL with your auth provider token (Bearer)."
- "For local testing, use a signed-in token from your app auth flow."

---

## 7) Operator checklist (when users ask “where are my keys?”)

1. Confirm project `mode = v2_shared`.
2. Confirm Service URL resolves and returns PostgREST responses.
3. Verify user token can query a known table.
4. Verify tenant data exists in shared schema.
5. Verify RLS allows intended reads for authenticated users.
