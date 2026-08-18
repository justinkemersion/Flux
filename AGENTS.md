# Agent / developer notes — Flux **v2_shared** client apps

Use this file when scaffolding **external** repos (Next.js, scripts, etc.) that talk to a Flux **pooled** (`v2_shared`) project over HTTPS + PostgREST. It captures non-obvious failures that do **not** show up in “happy path” snippets.

## Documentation freshness rule

When editing **this** Flux repo (not only external app repos):

- Meaningful **platform surface area** changes must update [`README.md`](README.md) and/or canonical docs in the **same commit** — see [`docs/README-MAINTENANCE-CONTRACT.md`](docs/README-MAINTENANCE-CONTRACT.md).
- Do **not** document aspirational features as shipped. Mark **experimental**, **beta**, **internal**, and **operator-only** surfaces clearly.
- **MCP / tooling** changes → README MCP section + [`packages/mcp/README.md`](packages/mcp/README.md) + [`docs/pages/guides/mcp.md`](docs/pages/guides/mcp.md).
- **CLI / dashboard / gateway / backup / security / deploy** changes → matching README section + relevant `docs/pages/*` or operator docs.
- **App developer footguns** (v2_shared URLs, schema, JWT, GRANT) → update **this file** and the relevant guide under `docs/pages/guides/`.
- Before marking work complete, run the checklist in [`docs/README-MAINTENANCE-CONTRACT.md`](docs/README-MAINTENANCE-CONTRACT.md).

Canonical deep dives in this repo:

- [`README.md`](README.md) — architecture, **JWT and schema isolation handshake** (gateway `Accept-Profile` / `Content-Profile`).
- [`docs/pages/guides/nextjs.md`](docs/pages/guides/nextjs.md) — minimal Next.js bootstrap (updated with pitfalls). Renders at `/docs/guides/nextjs` on the dashboard.
- [`docs/pages/guides/authjs.md`](docs/pages/guides/authjs.md) — Auth.js + RLS patterns. Renders at `/docs/guides/authjs`.
- [`docs/pages/guides/clerk.md`](docs/pages/guides/clerk.md) — Clerk + RLS patterns. Renders at `/docs/guides/clerk`.
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

- Same secret the platform uses for the tenant: mint HS256 JWTs that PostgREST accepts (`PGRST_JWT_SECRET` / dashboard “gateway” secret). On **v2_shared**, the `role` claim must be the per-tenant DB role **`t_<shortId>_role`** (same short id as `t_<shortId>_api`), plus a stable **`sub`** for per-row RLS. v1 dedicated stacks may still use **`authenticated`**.
- **`sub`** must match **`user_id`** column type and policy predicates (Flux examples often use **`text`** ids, e.g. OAuth `providerAccountId`).

---

## 4b) Foundry migrations on v2_shared (`flux push` rewrite)

Foundry ships Supabase-style SQL: unqualified tables, `GRANT … TO authenticated`, and sometimes `ON SCHEMA public`. On **v2_shared**:

- **`flux push`** runs inside `SET LOCAL ROLE t_<shortId>_role` and `SET LOCAL search_path TO t_<shortId>_api` — unqualified objects land in the tenant schema, and your SQL executes with tenant privileges, never the control-plane role.
- Before execution, Flux rewrites **`authenticated`** → **`t_<shortId>_role`** and schema **`public`** in privilege statements to the tenant API schema. Git file checksums are unchanged.
- **`authenticated` is an app-source compatibility token**, not a role on the shared cluster. Write `GRANT … TO authenticated` and `CREATE POLICY … TO authenticated`; do **not** add a `GRANT authenticated TO t_<shortId>_role` membership bridge. Historical migrations that added one are ledgered — leave them immutable rather than editing them.
- Prefer **`TO authenticated`** over omitting the `TO` clause. A policy with no `TO` is `TO PUBLIC` — valid, but broader than intended and not the canonical pattern.
- Rewriting is **lexical**: it applies only to executable SQL. Comments, single-quoted strings, quoted identifiers and dollar-quoted bodies are left byte-for-byte intact. SQL you build inside a `DO` block must therefore derive the role itself (`replace(current_schema(), '_api', '_role')` with `%I`) — `EXECUTE format('grant … to authenticated')` will **not** be adapted.
- Qualified **`public.<object>`** references are **not** rewritten — `public` still holds cluster-wide objects such as operator-installed extensions.
- Because SQL runs as the tenant role, statements requiring superuser (notably **`CREATE EXTENSION`**) are rejected; ask an operator to install extensions cluster-wide.
- At request time, the gateway performs the same role mapping on JWTs (`authenticated` in → `t_<shortId>_role` on the bridge JWT).

## 4c) RLS is mandatory on v1_dedicated API tables

`v1_dedicated` PostgREST endpoints do **not** pass through the Flux gateway. The database roles, grants, and RLS policies are the request-time authorization boundary.

- `flux push` rejects and rolls back the entire transaction if any table in the exposed API schema has RLS disabled or has RLS enabled with zero policies.
- A migration that repairs existing unsafe tables is allowed because the audit runs after the migration SQL and before commit. Repair every flagged table in the same migration.
- If a table is intentionally inaccessible, create an explicit deny-all policy (`USING (false) WITH CHECK (false)`) rather than leaving it policyless.
- `flux doctor` reports this condition as a failed **API schema RLS** check for dedicated projects. `flux db inspect` reports table-level `rls_disabled` and `rls_enabled_without_policies` warnings.

This dedicated-only push gate does not change the v2 baseline: `v2_shared` has gateway authentication plus schema/role isolation, and RLS remains an optional application-level control there.

---

## 5) RLS is not enough — **`GRANT`**

Policies filter rows **after** the DB role is allowed to touch the table. Without:

```sql
GRANT USAGE ON SCHEMA t_<shortId>_api TO t_<shortId>_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE t_<shortId>_api.<table> TO t_<shortId>_role;
```

(Grant to the same role your JWT `role` claim uses — on v2_shared that is **`t_<shortId>_role`**, not `authenticated`.) Without grants, PostgREST returns **403** / **`42501`**, not an empty array.

**Your migrations do not run as your JWT role.** On v2_shared, Flux executes pushed SQL as a separate per-tenant owner role, **`t_<shortId>_ddl`**, because a table owner bypasses RLS in PostgreSQL — if DDL ran as `t_<shortId>_role`, every table it created would stop enforcing policies for your own app. So tables you create are owned by `t_<shortId>_ddl`; `SELECT` is granted to your runtime role automatically, and **writes still require the explicit `GRANT` above**. Flux also applies `FORCE ROW LEVEL SECURITY` to tenant tables that already have RLS enabled (opt out with a table comment containing `flux:no-force-rls`). See [`docs/pages/guides/migrations.md`](docs/pages/guides/migrations.md).

---

## 6) TLS from Node / serverless **`fetch`**

If the public API endpoint presents a cert that Node does not trust (private CA, lab ingress):

- Prefer **`NODE_EXTRA_CA_CERTS`** (or system trust store) over global `NODE_TLS_REJECT_UNAUTHORIZED=0` (that weakens **all** HTTPS in the process, including OAuth to GitHub).
- If you must scope trust relaxation, do it only on the Flux HTTP client (e.g. undici `Agent` `rejectUnauthorized: false` behind an explicit env flag), never as default production behavior.

---

## 7) CLI ergonomics

- Foundry apps ship **`flux.json`** with **`hash": "REPLACE_AFTER_FLUX_INIT"`**. Run **`flux login`** then **`flux init`** from the app repo to link or create the project and write the real hash (no secrets in `flux.json`). Then **`pnpm flux:schema:sync`** and **`flux push`** migrations.
- Put **`slug`** (and **`hash`** when required) in a repo-root **`flux.json`** so `flux push migrations/` or `flux push ./migration.sql` does not require `-p` / `--hash` every time (`flux push --help`). Directory push applies ordered `.sql` files with a `flux.flux_migrations` ledger (`flux` schema, not in PostgREST); use **`flux push --plan`**, **`--dry-run`**, and **`flux migrations list`** to inspect before applying. **`flux migrations`** is the SQL ledger—not **`flux migrate`** (v2_shared → v1_dedicated). **Do not edit a versioned migration after it has been applied—create a new migration instead.** Single files under `migrations/`, `flux/migrations/`, or `sql/migrations/` default to versioned; elsewhere default to raw. Use **`flux push path.sql --mode repeatable --force`** for idempotent demo seed/reset scripts (ledger: `flux.flux_repeatable_scripts`). Use **`--mode raw`** for intentional ad-hoc runs under `migrations/`.
- After SQL, Flux triggers PostgREST reload; large schema changes may still need a moment before first request.
- Optional repo **`FLUX.md`** is the project brief (distinct from dashboard operator metadata). Generate with **`flux project brief generate`** (when the host has Workers AI) or **`flux project brief prompt`**, then **`flux project brief push`**. Summarize activity with **`flux project summarize`**.

## 8) Auth.js (Next.js) next to Flux

- Set **`AUTH_SECRET`** (or `NEXTAUTH_SECRET`); missing secret breaks `/api/auth/session`.
- Rotating **`AUTH_SECRET`** invalidates existing session cookies until browsers clear them (Auth.js may log `JWTSessionError` once while clearing).

---

## 9) When editing **this** Flux repo

`apps/dashboard/AGENTS.md` covers dashboard-only agent rules. This root **`AGENTS.md`** is for **cross-repo** consumers and operators wiring **v2_shared** apps.

If you fix a recurring footgun (URL printed wrong, missing profile in templates, etc.), update **this file** and the **quickstart** guide together so drift stays low.

**Pooled migration ledger:** On shared Postgres, if directory **`flux push`** reports a legacy global **`flux.flux_migrations`** ledger with existing rows, run **`bin/migrate-pooled-ledger.sh --assign-legacy-to t_<shortId>_api`** on the Flux host (see root **README**). Do not auto-attribute legacy rows to the wrong tenant.
