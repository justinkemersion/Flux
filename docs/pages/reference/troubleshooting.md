---
title: Troubleshooting
description: Reader-symptom-first map from common Flux errors to the layer that caused them, what to verify, and the usual fix.
section: reference
---

# Troubleshooting

This page maps common Flux symptoms to the layer that usually caused them. It is organized by what the reader **sees**, not by what the platform internally **does**, because the reader's only entry point is the symptom.

Most issues fall into one of four categories:

- **Authentication** — the gateway rejected the request before it reached PostgreSQL.
- **Authorization** — the request reached PostgreSQL, and the role or RLS policy refused.
- **Request routing** — the request never reached the right host, schema, or table.
- **Schema or migration state** — what the database holds does not match what the application asked for.

Read the layer-stack framing first; it cuts the search space dramatically before any individual entry.

## How to think about Flux failures

A Flux request crosses a small number of layers. Each layer can refuse, and each layer refuses with a recognizable signal. Identifying the layer first turns "something is broken" into "this specific layer is broken":

```txt
1. Edge / TLS                    network or certificate failure
2. Flux gateway                  401 — token missing, malformed, or signed by the wrong secret
3. PostgREST                     401 — gateway accepted, PostgREST rejected (rare on v2 shared)
                                 404 — table does not exist in the schema PostgREST is looking at
4. Postgres role                 403 / 42501 — role lacks GRANT on schema or table
5. RLS policies                  empty array — role is allowed to read, no rows match the policy
6. Application                   incorrect fetch usage, stale token in browser storage, etc.
```

When a request fails, walk the stack top-down. The first layer that produces the observed symptom is usually the right one. The most common debugging mistake is to suspect RLS when the failure is actually at the gateway, because both eventually hide the data.

The reference for the full request lifecycle is [Request flow](/docs/architecture/request-flow); the trust boundaries those layers enforce are in [Authentication model](/docs/security/authentication-model) and [Tenant isolation](/docs/security/tenant-isolation).

---

## 401 Unauthorized

**Layer.** Flux gateway (v2 shared) or PostgREST (v1 dedicated). The request was rejected **before** any SQL ran.

**What it usually means.** The presented JWT was missing, malformed, expired, or signed with a secret the project does not accept. On v2 shared the gateway is the gate; on v1 dedicated PostgREST validates directly using the per-project `PGRST_JWT_SECRET`.

**How to verify.**

```bash
# Confirm the request is reaching the right host
curl -sS -o /dev/null -w "%{http_code}\n" \
  "https://api--<slug>--<hash>.<base-domain>/notes?select=id&limit=1"
# 401 = routed correctly, auth refused. 404 = wrong host or path.

# Inspect the token claims (jose CLI, jwt.io, or any decoder)
echo "<token>" | cut -d. -f2 | base64 -d | jq .
# Confirm: alg=HS256, role present, sub present, exp in the future.
```

**Common fixes.**

- Re-mint the token using the project's **JWT secret** from the dashboard, not a value from a different project or environment.
- Confirm the algorithm matches what Flux expects (HS256 by default).
- Make sure the `Authorization: Bearer <token>` header is actually being sent — `Authorization` is case-sensitive in some HTTP libraries, and some client SDKs strip it on cross-origin requests.
- For Clerk: regenerate the JWT template's signing key and paste it into the Flux project settings; see [Clerk with Flux](/docs/guides/clerk).
- For Auth.js: confirm the server route mints a Flux-compatible token, not the Auth.js session cookie; see [Auth.js with Flux](/docs/guides/authjs).

**Engine.** Both `v2_shared` and `v1_dedicated`.

**Related pages.** [JWT authentication](/docs/concepts/jwt-auth), [Bridge JWTs](/docs/architecture/bridge-jwts), [Authentication model](/docs/security/authentication-model).

---

## 403 Forbidden

**Layer.** Postgres role privileges, evaluated **after** authentication succeeded.

**What it usually means.** The JWT was accepted. The request reached PostgreSQL. The role named by the `role` claim is not allowed to touch the table the request asked for. RLS has not even been consulted yet — `GRANT` decides whether the role may look at the table at all.

This is the single most useful distinction in Flux debugging:

```
401  →  the gateway refused.       SQL never ran.
403  →  the role is not allowed.   SQL was attempted, then denied.
empty array  →  the role is allowed, RLS filtered everything.
```

A reader who internalizes those three lines can locate almost any Flux failure to the right layer in seconds.

**How to verify.** From a `psql` or SQL editor connected as a superuser:

```sql
-- Did the role exist?
select rolname from pg_roles where rolname = 'authenticated';

-- Does the role have schema access?
select has_schema_privilege('authenticated', 't_5ecfa3ab72d1_api', 'USAGE');

-- Does the role have table access?
select has_table_privilege('authenticated',
  't_5ecfa3ab72d1_api.notes', 'SELECT');
```

Any `false` result is the answer.

**Common fixes.**

```sql
grant usage on schema t_5ecfa3ab72d1_api to authenticated;
grant select, insert, update, delete
  on table t_5ecfa3ab72d1_api.notes
  to authenticated;
```

Apply via `flux push` so the grant is tracked in version control.

**Engine.** Both engines. On v2 shared the schema name is `t_<shortId>_api`; on v1 dedicated the schema is whatever the project's bootstrap created.

**Related pages.** [RLS boundaries](/docs/security/rls-boundaries), [Authentication model](/docs/security/authentication-model).

---

## Empty array instead of an error

**Layer.** Row-level security. The role was allowed to query the table; no rows matched the policy.

**What it usually means.** This is **not** a bug. PostgreSQL is returning the truthful answer to "which rows is this role allowed to see right now?" The answer is "none."

Three causes account for almost all instances:

- The `sub` claim in the JWT does not equal the row's owner column.
- The owner column is `uuid` and the JWT `sub` is `text` — Postgres compares them and finds no match without an explicit cast.
- The policy filters on a column that has not been populated yet (`null` for new rows).

**How to verify.** Read the actual claim and compare to a stored row:

```sql
-- What claim is the request running as?
select current_setting('request.jwt.claim.sub', true) as jwt_sub;

-- What does the row actually contain?
select id, owner_id, pg_typeof(owner_id) from t_5ecfa3ab72d1_api.notes limit 5;
```

If `pg_typeof(owner_id)` returns `uuid` and `jwt_sub` returns a string id from an OAuth provider, the comparison silently fails.

**Common fixes.**

- Migrate `owner_id` columns to `text` for OAuth-style identities (Clerk `user.id`, GitHub provider account ids, e-mails).
- Or write the policy as `owner_id::text = auth.uid()` if changing the column is not possible.
- For new tables, default owner columns to `text` from the start.

A canonical RLS-friendly schema is in [Auth.js with Flux](/docs/guides/authjs).

**Engine.** Both engines, when RLS is enabled.

**Related pages.** [Row-level security (concepts)](/docs/concepts/rls), [RLS boundaries](/docs/security/rls-boundaries).

---

## 42501 permission denied

**Layer.** Postgres. `42501` is the SQLSTATE code Postgres uses for **permission denied**.

**What it usually means.** A `GRANT` is missing somewhere in the chain. The role might be allowed to use the schema but not the table, or allowed to read but not write, or the schema itself has no `USAGE` grant. The error string usually names which one is missing — read it carefully:

```
42501 / permission denied for schema t_5ecfa3ab72d1_api
42501 / permission denied for table notes
```

**How to verify.**

```sql
select has_schema_privilege('authenticated', 't_5ecfa3ab72d1_api', 'USAGE');
select has_table_privilege('authenticated',
  't_5ecfa3ab72d1_api.notes', 'SELECT');
select has_table_privilege('authenticated',
  't_5ecfa3ab72d1_api.notes', 'INSERT');
```

**Common fixes.**

- `permission denied for schema` → `grant usage on schema <name> to <role>;`
- `permission denied for table` → `grant <privilege> on table <schema>.<table> to <role>;`
- `permission denied for sequence` → autoincrement insert without the sequence grant; `grant usage, select on sequence <name> to <role>;`

`42501` is **not** an RLS failure. RLS would return an empty array, not an error.

**Engine.** Both engines.

**Related pages.** [403 Forbidden](#403-forbidden), [RLS boundaries](/docs/security/rls-boundaries).

---

## Migration succeeded but queries fail

**Layer.** Schema, search path, or PostgREST schema cache.

**What it usually means.** The SQL applied. The application is asking for objects in a different schema, or PostgREST has not noticed the change yet.

The four common causes:

1. **Wrong schema.** The migration created tables in `public`; pooled PostgREST reads from `t_<shortId>_api`. The tables exist, but PostgREST does not see them.
2. **Missing `Accept-Profile` / `Content-Profile` headers.** The application is bypassing the gateway and talking to PostgREST directly without naming a schema. PostgREST falls back to its default and finds nothing.
3. **Stale PostgREST schema cache.** PostgREST reloads on `NOTIFY pgrst, 'reload schema'`; `flux push` triggers it, but a hand-applied migration may not.
4. **Missing grants on the new objects.** The table exists; the role cannot reach it. See [42501](#42501-permission-denied).

**How to verify.**

```sql
-- Does the object exist in the expected schema?
select schemaname, tablename
from pg_tables
where tablename = 'notes';

-- What does PostgREST see right now?
-- (Hit the OpenAPI endpoint; absent paths mean PostgREST does not see the table.)
```

```bash
curl -sS "https://api--<slug>--<hash>.<base-domain>/" \
  -H "Authorization: Bearer <token>" \
  | jq '.paths | keys | .[]' | grep notes
```

**Common fixes.**

- Always qualify the schema in migrations targeting v2 shared:

  ```sql
  create table if not exists t_5ecfa3ab72d1_api.notes (...);
  ```

- Push migrations with `flux push` so PostgREST reloads automatically.
- Send `Accept-Profile: t_5ecfa3ab72d1_api` (and `Content-Profile` for mutations) when calling PostgREST without the gateway. The `fluxFetch` helper in [Next.js with Flux](/docs/guides/nextjs) does this.

**Engine.** Both engines, but the `t_<shortId>_api` schema convention is `v2_shared` only.

**Related pages.** [Migrations workflow](/docs/guides/migrations), [Service URLs](/docs/concepts/service-urls).

---

## JWT looks valid but Flux rejects it

**Layer.** Gateway JWT verification.

**What it usually means.** The token decodes and the claims look right, but verification fails. The cause is almost always one of: wrong secret, wrong algorithm, missing required claim, or clock skew.

**How to verify.** Decode the token and inspect the protected header alongside the body:

```bash
TOKEN=<paste here>
echo "$TOKEN" | cut -d. -f1 | base64 -d 2>/dev/null | jq .   # header
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq .   # body
```

Then check the project's expectations:

- `alg` in the header must be `HS256` unless the project is configured otherwise.
- `role` in the body must name a Postgres role that exists in the tenant database (typically `authenticated` or `anon`).
- `sub` must be present if any RLS policy uses `auth.uid()`.
- `exp` must be in the future, accounting for clock skew between the token signer and the gateway.

**Common fixes.**

| Cause | Fix |
|-------|-----|
| Token signed with a stale secret after a rotation | Re-fetch the project secret; restart the issuer |
| `role` claim names a role that does not exist | `create role <name> nologin;` and grant accordingly |
| Issuer's clock is behind the gateway | Synchronize NTP on the issuer; widen `exp` by a small leeway |
| Token signed by the wrong project's secret | Confirm `FLUX_JWT_SECRET` references the right project |
| Algorithm mismatch (token is RS256, project expects HS256) | Reissue with `alg: HS256` or reconfigure the project |

**Engine.** Both engines.

**Related pages.** [JWT authentication](/docs/concepts/jwt-auth), [Project secrets](/docs/security/project-secrets).

---

## Pooled-specific misunderstandings

**Layer.** Application's mental model of v2 shared.

**What it usually means.** v2 shared deliberately removes some affordances familiar from other BaaS platforms. The symptoms below are not bugs; they are the contract:

- **"Where is the anon key?"** There is no static anonymous key on v2 shared. Every request is identified through a JWT validated by the gateway. The anon-style key on v1 dedicated does not exist on pooled stacks; see [Authentication model](/docs/security/authentication-model).
- **"Why can't I connect to PostgREST directly?"** Pooled PostgREST is not addressable from the public internet. The gateway is the public surface; PostgREST runs behind it. See [Gateway](/docs/architecture/gateway).
- **"Why is my schema named `t_<hash>_api`?"** The tenant schema name is platform-issued, derived from an internal short id. It is the technical schema for your tenant; the marketing slug is independent. Read the canonical name from the dashboard, `flux list`, or the gateway-injected profile headers.
- **"Can I bypass the gateway and use my own JWT?"** No. The gateway mints a short-lived bridge JWT for PostgREST; the project secret never leaves the platform. See [Bridge JWTs](/docs/architecture/bridge-jwts).
- **"My old `https://api.<slug>.<hash>.<base>` URL stopped working."** That dotted form is the legacy v1 dedicated host. The canonical external host for both engines is the flattened `https://api--<slug>--<hash>.<base>`. New stacks accept both at Traefik; client code should use the flattened form.

**Common fixes.** None — these are intended behaviors. The fix is to align the application's expectations with the v2 shared contract documented in [Flux v2 architecture](/docs/architecture/flux-v2-architecture) and [Pooled vs dedicated](/docs/concepts/pooled-vs-dedicated).

**Engine.** `v2_shared` only.

**Related pages.** [Flux v2 architecture](/docs/architecture/flux-v2-architecture), [Pooled vs dedicated](/docs/concepts/pooled-vs-dedicated), [Gateway](/docs/architecture/gateway).

---

## When the issue is probably not Flux

Several common symptoms look like Flux failures but originate in the application itself. Checking these first saves time:

- **Stale token in browser storage.** Sign-out is incomplete, the cookie or `localStorage` entry persists, and an expired token continues to be sent. Clear site data and retry.
- **`fetch` cached an old response.** Next.js `fetch` and some service workers cache aggressively. Add `cache: "no-store"` or appropriate revalidation, especially on server components.
- **JSON parsing on a non-JSON body.** A failed request returns text or HTML; calling `.json()` on it throws an error that looks unrelated to the actual cause. Read `.text()` first when debugging.
- **CORS, not authentication.** The browser blocks the response before the application sees it. Look in the network tab for an OPTIONS preflight; the underlying request may have actually succeeded.
- **Wrong environment.** A staging frontend is calling a production Flux project (or vice versa) because environment variables were set at build time and the build was not rebuilt.
- **Rate limit at a different layer.** A reverse proxy in front of Flux is rate-limiting; the symptom looks like an intermittent 4xx but is not coming from Flux.

If none of the above match and the symptom does not appear in any entry above, the layer-stack framing at the top of this page is the right place to start over.

## Next steps

- [Request flow](/docs/architecture/request-flow) — the layered model that makes the symptoms above predictable
- [Authentication model](/docs/security/authentication-model) — what the gateway is doing in steps 2–3
- [RLS boundaries](/docs/security/rls-boundaries) — what RLS does and does not protect
- [JWT authentication](/docs/concepts/jwt-auth) — claim contract and token lifecycle
