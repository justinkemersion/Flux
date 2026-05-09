# Agent / developer notes — Flux **v2_shared** client apps

Use this file when scaffolding **external** repos (Next.js, scripts, etc.) that talk to a Flux **pooled** (`v2_shared`) project over HTTPS + PostgREST. It captures non-obvious failures that do **not** show up in “happy path” snippets.

Canonical deep dives in this repo:

- [`README.md`](README.md) — architecture, **JWT and schema isolation handshake** (gateway `Accept-Profile` / `Content-Profile`).
- [`docs/guides/flux-nextjs-v2-shared-quickstart.md`](docs/guides/flux-nextjs-v2-shared-quickstart.md) — minimal Next.js bootstrap (updated with pitfalls).
- [`docs/guides/flux-nextjs-authjs-rls.md`](docs/guides/flux-nextjs-authjs-rls.md) — Auth.js + RLS patterns.
- [`docs/pages/architecture/flux-v2-architecture.md`](docs/pages/architecture/flux-v2-architecture.md) — v2 invariants, threat model, tenant isolation, and operational behavior. Renders at `/docs/architecture/flux-v2-architecture` on the dashboard.

---

## 1) API base URL: canonical **triple-dash** host (and legacy dotted)

`flux list` / the dashboard show the **canonical** tenant API origin for both engines:

`https://api--<slug>--<hash>.vsl-base.com`

(double dashes **around** the slug).

**Legacy (transitional):** older v1 dedicated stacks may still answer on the dotted host `https://api.<slug>.<hash>.vsl-base.com`. New stacks accept **both** hostnames at Traefik; the flattened URL is the single external contract to wire in apps.

**Rule:** Prefer the URL from `flux list` / dashboard (flattened). If you must debug an old client still on the dotted host, keep the same `PGRST_JWT_SECRET` / gateway secret. Prefer verifying with `curl` before wiring env vars.

---

## 2) Tenant tables live in **`t_<shortId>_api`**, not `public`

v2_shared provisions an isolated schema per tenant, e.g. `t_5ecfa3ab72d1_api` (name comes from an internal short id, **not** the project slug).

- SQL pushed via `flux push` must **`CREATE TABLE`** (and policies, indexes) **in that schema**, or you get  
  **`42501` / `permission denied for schema t_…_api`** when PostgREST evaluates requests.
- **`public.mytab`** is wrong for pooled PostgREST unless your migration explicitly targets pooled layout and the control plane moves objects (do not assume `public`).

**Discover the schema name:** Postgres error text, operator notes, or (when going through the gateway) the **`Accept-Profile`** / **`Content-Profile`** values the gateway injects (see README *JWT and schema isolation handshake*).

---

## 3) PostgREST **profiles** when calling the API **without** the Flux gateway

If your app uses a **library `fetch` straight to PostgREST** (not through `@flux/gateway`), you must send schema negotiation headers yourself ([PostgREST schemas](https://postgrest.org/en/stable/references/api/schemas.html)):

| HTTP | Header |
|------|--------|
| `GET`, `HEAD` | `Accept-Profile: t_<shortId>_api` |
| `POST`, `PATCH`, `PUT`, `DELETE` | `Content-Profile: t_<shortId>_api` |

Omitting these when `db-schemas` lists multiple schemas (or default is not where your tables live) yields empty errors, wrong schema, or permission errors.

---

## 4) JWT for PostgREST (HS256)

- Same secret the platform uses for the tenant: mint HS256 JWTs that PostgREST accepts (`PGRST_JWT_SECRET` / dashboard “gateway” secret). Typical claims: **`role: "authenticated"`** (or what your policies target) and a stable **`sub`** for per-row RLS.
- **`sub`** must match **`user_id`** column type and policy predicates (Flux examples often use **`text`** ids, e.g. OAuth `providerAccountId`).

---

## 5) RLS is not enough — **`GRANT`**

Policies filter rows **after** the DB role is allowed to touch the table. Without:

```sql
GRANT USAGE ON SCHEMA t_<shortId>_api TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE t_<shortId>_api.<table> TO authenticated;
```

(and similarly for other roles your JWT uses), PostgREST returns **403** / **`42501`**, not an empty array.

---

## 6) TLS from Node / serverless **`fetch`**

If the public API endpoint presents a cert that Node does not trust (private CA, lab ingress):

- Prefer **`NODE_EXTRA_CA_CERTS`** (or system trust store) over global `NODE_TLS_REJECT_UNAUTHORIZED=0` (that weakens **all** HTTPS in the process, including OAuth to GitHub).
- If you must scope trust relaxation, do it only on the Flux HTTP client (e.g. undici `Agent` `rejectUnauthorized: false` behind an explicit env flag), never as default production behavior.

---

## 7) CLI ergonomics

- Put **`slug`** (and **`hash`** when required) in a repo-root **`flux.json`** so `flux push ./migration.sql` does not require `-p` / `--hash` every time (`flux push --help`).
- After SQL, Flux triggers PostgREST reload; large schema changes may still need a moment before first request.

---

## 8) Auth.js (Next.js) next to Flux

- Set **`AUTH_SECRET`** (or `NEXTAUTH_SECRET`); missing secret breaks `/api/auth/session`.
- Rotating **`AUTH_SECRET`** invalidates existing session cookies until browsers clear them (Auth.js may log `JWTSessionError` once while clearing).

---

## 9) When editing **this** Flux repo

`apps/dashboard/AGENTS.md` covers dashboard-only agent rules. This root **`AGENTS.md`** is for **cross-repo** consumers and operators wiring **v2_shared** apps.

If you fix a recurring footgun (URL printed wrong, missing profile in templates, etc.), update **this file** and the **quickstart** guide together so drift stays low.
