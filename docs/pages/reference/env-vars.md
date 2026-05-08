---
title: Environment variables
description: The env vars you'll touch building on Flux — what they are, where they live, and the names that look alike.
---

# Environment variables

This page lists the environment variables you'll set or see while building an app on Flux. It's organised by what you're trying to do — wire your app, configure auth, drive the CLI, debug a TLS chain — and ends with an alphabetical lookup table.

Self-hosted operators have a separate set of platform-side variables (gateway secrets, system database URLs, container resource limits). Those are not documented here; see [Production hardening](/docs/guides/production-hardening) instead.

## What you will learn

- The three variables your app needs to call a Flux project
- How `FLUX_GATEWAY_JWT_SECRET` is used at the app boundary
- Which CLI variables come from `.env` vs the shell vs `flux.json`
- The names that look alike and how to keep them straight
- A flat alphabetical index for quick lookup

## The idea

Flux exposes two different surfaces to your environment:

- The **project surface** — your app talks to a Flux project's Service URL using a JWT it minted with the project's secret. Three variables.
- The **control plane surface** — the CLI talks to the Flux dashboard API to create projects, push SQL, list status. A different base URL and a different token.

These two surfaces use different variables on purpose. Mixing them is the most common source of confusion, so the [Names that look alike](#names-that-look-alike) section at the bottom of this page is worth a read.

## 1. Wiring your app to a Flux project

These are the variables `flux create` and the dashboard project page print into your `.env`.

### `NEXT_PUBLIC_FLUX_URL`

The project's **Service URL**, exposed to the browser bundle. Use this when fetch runs in the browser (client components, browser-side actions).

- **Type:** URL — usually the canonical flattened form `https://api--<slug>--<hash>.vsl-base.com`.
- **Where it's set:** `.env.local` (or `.env`) of your app repo.
- **Sensitive:** No — this URL is part of every browser request anyway.
- **Source:** copy from `flux list` or the project page in the dashboard. See [Service URLs](/docs/concepts/service-urls).

### `FLUX_URL`

Same value as `NEXT_PUBLIC_FLUX_URL`, but for **server-only** code paths (route handlers, server actions, scripts). Setting both with the same value is normal — Next.js only exposes the `NEXT_PUBLIC_*` form to the browser.

- **Type:** URL.
- **Where it's set:** `.env.local` of your app repo, or your server's process env.
- **Sensitive:** No.
- **Notes:** Some older guides use `FLUX_SERVICE_URL` for the same purpose. Both still work; `FLUX_URL` is the name printed by `flux create` and the canonical form going forward.

### `FLUX_GATEWAY_JWT_SECRET`

The **per-project HS256 secret** your app uses to sign JWTs that the Flux gateway will accept. This is the same value as your project's `jwt_secret` in the control plane — the dashboard's *Project → Keys* panel and `flux env` reveal it.

- **Type:** string, at least 32 bytes (`openssl rand -base64 48` is the typical generator).
- **Where it's set:** `.env.local` (server-only — never expose this in browser bundles).
- **Sensitive:** **Yes.** Treat it like a session-signing key. Anyone with this secret can mint tokens that Flux will accept for your project.
- **Footgun:** the operator surface uses this **exact same name** for a different, cluster-wide secret on the PostgREST pool. Sarah-the-app-builder cares about the per-project value; Justin-the-operator cares about the pool value. See [Names that look alike](#names-that-look-alike).

### `FLUX_BEARER_TOKEN` *(scripts and CI only)*

A pre-minted JWT used as an explicit override when you don't want your script to do the signing — useful for one-off curl calls, smoke tests, or CI that doesn't carry a user session. The Auth.js + RLS guide uses this for the simplest possible server-side example.

- **Type:** string (a JWT).
- **Where it's set:** the script's environment, or `.env.local` for local development.
- **Sensitive:** Yes — it grants the same access as the role + claims it carries. Keep TTLs short.
- **When to skip it:** in production, mint tokens at request time from your auth provider's session instead.

### `FLUX_POSTGREST_SCHEMA` *(direct-to-PostgREST callers only)*

When your app talks to PostgREST **without going through the Flux gateway** — usually for local development, internal tooling, or operators bypassing the public ingress — PostgREST needs a schema name in the `Accept-Profile` (GET/HEAD) and `Content-Profile` (POST/PATCH/PUT/DELETE) headers. This variable holds that name.

- **Type:** schema identifier, of the form `t_<12-hex-shortid>_api`.
- **Where it's set:** the calling process's env.
- **Sensitive:** No.
- **When to skip it:** if your app calls the Service URL through the gateway, the gateway injects these headers for you and you don't need this variable. See [JWT authentication](/docs/concepts/jwt-auth).

## 2. Auth wiring (Auth.js, Clerk)

Auth.js is the most common identity provider for Flux apps. The variables below are Auth.js's, not Flux's, but they appear in every working Flux app and Flux is sensitive to a few of them.

### `AUTH_SECRET` (alias `NEXTAUTH_SECRET`)

Session signing key for Auth.js v5. The dashboard `auth.ts` accepts either name and aliases the legacy `NEXTAUTH_SECRET` to `AUTH_SECRET` automatically.

- **Sensitive:** Yes.
- **Rotation:** rotating this **invalidates every existing session cookie**. Auth.js will log a one-time `JWTSessionError` while browsers clear stale cookies. This is expected.
- **Distinct from `FLUX_GATEWAY_JWT_SECRET`** — `AUTH_SECRET` signs your app's *session cookie*; `FLUX_GATEWAY_JWT_SECRET` signs the *bearer JWT* you mint for Flux. They are independent secrets and should be different values.

### `AUTH_URL` (alias `NEXTAUTH_URL`)

Public origin Auth.js uses for callback URLs (`/api/auth/callback/<provider>`). Either name works.

- **Sensitive:** No.

### `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` (legacy `GITHUB_ID` / `GITHUB_SECRET`)

OAuth credentials when you use GitHub as a provider. The dashboard accepts the unprefixed legacy names too.

- **Sensitive:** Yes (the secret).

### `AUTH_DEBUG`

Set to `1` to enable Auth.js verbose logging. Off by default.

## 3. Driving the CLI

The CLI reads `.env` and `.env.local` from the directory containing your `flux.json` (it walks up from the current working directory until it finds one). Shell exports always win — these dotenv values only fill in keys the shell didn't already set. The CLI loads exactly five keys from those files: `FLUX_API_BASE`, `FLUX_DASHBOARD_BASE`, `FLUX_API_TOKEN`, `FLUX_DEFAULT_MODE`, `FLUX_GATEWAY_JWT_SECRET`.

### `FLUX_API_BASE`

The **control plane dashboard API origin**, including the trailing `/api` segment. The CLI uses this to call `flux list`, `flux create`, `flux push`, and friends. Distinct from `FLUX_URL` (see [Names that look alike](#names-that-look-alike)).

- **Type:** URL ending in `/api`, no trailing slash. Example: `https://flux.vsl-base.com/api`.
- **Where it's set:** shell export or `.env`/`.env.local` next to `flux.json`.
- **Sensitive:** No.
- **Inference:** when `FLUX_URL` (or `NEXT_PUBLIC_FLUX_URL`) is a hosted `*.vsl-base.com` Service URL, the CLI infers `FLUX_API_BASE = https://flux.vsl-base.com/api` automatically. Self-hosted custom domains must set this explicitly.
- **Self-hosted:** point this at your own dashboard origin + `/api`.

### `FLUX_API_TOKEN`

Your **personal API token** for the control plane, generated in *Settings → API keys* in the dashboard.

- **Type:** opaque string, conventionally prefixed `flx_live_` or `flx_test_`.
- **Where it's set:** shell export or `.env`/`.env.local`.
- **Sensitive:** Yes — anyone with this token can act as you against the control plane (create projects, push SQL, read project credentials). Rotate via the dashboard if leaked.

### `FLUX_DEFAULT_MODE`

Default engine when running `flux create` without `--mode`. Without it, the control plane picks the default for your plan.

- **Type:** `v1_dedicated` or `v2_shared`.
- **Where it's set:** shell export or `.env`/`.env.local`.
- **Sensitive:** No.

### `FLUX_DASHBOARD_BASE`

Override for the dashboard's *web* origin (the one a human would visit), distinct from the API origin. The CLI uses this when it needs to print human-clickable links. Defaults to `FLUX_API_BASE` with the trailing `/api` stripped.

- **Type:** URL, no trailing slash.
- **Where it's set:** shell export or `.env`/`.env.local`.
- **Sensitive:** No.
- **When to skip it:** almost always. Set it only if your dashboard isn't reachable at the same origin as the API.

### `FLUX_DEBUG`

Verbose CLI logging. Truthy when set to any non-empty value other than `0`.

- **Type:** flag (any non-empty value other than `"0"` enables).
- **Sensitive:** No.

### `flux.json` (not an env var, but adjacent)

The CLI looks for `flux.json` next to your app to skip having to pass `--project` and `--hash` every time. Two fields, both required:

```json
{ "slug": "bloom-atelier", "hash": "0a1b2c3" }
```

- `slug` — the project's slug as shown by `flux list`.
- `hash` — the 7-hex `hash` segment from the same row.

`flux.json`'s presence also defines the directory the CLI treats as the project root for `.env` lookup.

## 4. PostgREST container envs *(v1_dedicated only)*

On **v1_dedicated** projects, each project owns its own PostgREST container, and `flux env list` shows that container's `Config.Env`. On **v2_shared** projects there's no per-project container — the entire project shares one pooled PostgREST — so `flux env list` returns nothing.

The variables below appear only on dedicated stacks. You can read them but they're managed by Flux; setting them yourself is rarely the right answer.

### `PGRST_DB_URI`

PostgREST's connection string to the project's Postgres. **Sensitive** — the value is hidden by `flux env list`.

### `PGRST_JWT_SECRET`

The HS256 secret PostgREST uses to verify incoming JWTs. On dedicated stacks this matches your `FLUX_GATEWAY_JWT_SECRET`. **Sensitive** — hidden by `flux env list`.

### `PGRST_DB_SCHEMAS`

Comma-separated list of schemas PostgREST exposes. Defaults to `api` on dedicated.

### `PGRST_DB_ANON_ROLE`

Role PostgREST uses for unauthenticated requests. Defaults to `anon`.

## 5. TLS and runtime

Two Node.js variables that come up when Flux is behind a private CA or a development ingress with a self-signed cert.

### `NODE_EXTRA_CA_CERTS`

Path to a PEM bundle Node should trust **in addition to** its built-in CA store. Use this to add a corporate or lab CA without weakening TLS for everything else the process talks to.

- **Type:** filesystem path.
- **When you need it:** custom domain on a private CA, or local TLS terminator with its own root.

### `NODE_TLS_REJECT_UNAUTHORIZED`

Set to `0` to disable TLS verification process-wide. **Don't.**

This weakens **every** HTTPS connection the Node process makes — including OAuth callbacks to GitHub, Stripe, and your auth provider — not just the call to Flux. If you genuinely need to relax TLS for development, scope it to the Flux client only (e.g. an explicit undici `Agent` with `rejectUnauthorized: false` behind a clearly-named env flag), never as the default. See [Production hardening](/docs/guides/production-hardening).

## Names that look alike

Most env-var pain on Flux comes from these four collisions. Skim before you debug a 401.

| You wrote | But meant | What gives it away |
|---|---|---|
| `FLUX_GATEWAY_JWT_SECRET` (operator value) | `FLUX_GATEWAY_JWT_SECRET` (per-project value from your project's *Keys*) | Same name in your app's `.env` and on the operator's pool — but they're different secrets. App side: signs *your* tokens. Operator side: signs the gateway-to-PostgREST handshake. Use the value from `flux env` or the dashboard, never the platform's pool secret. |
| `FLUX_API_BASE` | `FLUX_URL` | `FLUX_API_BASE` is the **control plane** URL ending in `/api` and is used by the CLI. `FLUX_URL` is **your project's Service URL** and is used by your app. Mixing them yields 404s on `/api/projects/...` or `/notes?select=...`. |
| `FLUX_URL` | `FLUX_SERVICE_URL` | Same value, two names. The canonical name is `FLUX_URL` (printed by `flux create`); `FLUX_SERVICE_URL` is a legacy alias still used in some guides. |
| `AUTH_SECRET` | `FLUX_GATEWAY_JWT_SECRET` | `AUTH_SECRET` signs your app's session cookie (Auth.js). `FLUX_GATEWAY_JWT_SECRET` signs the bearer JWT you mint *for Flux*. They're independent and should be different values. |

## Quick lookup

Alphabetical, so you can `Ctrl+F` from another page.

| Variable | Section | One-line |
|---|---|---|
| `AUTH_DEBUG` | [Auth wiring](#2-auth-wiring-authjs-clerk) | Auth.js verbose logging (`1` to enable). |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | [Auth wiring](#2-auth-wiring-authjs-clerk) | GitHub OAuth client credentials (legacy `GITHUB_ID` / `GITHUB_SECRET` accepted). |
| `AUTH_SECRET` | [Auth wiring](#2-auth-wiring-authjs-clerk) | Auth.js session signing key (alias `NEXTAUTH_SECRET`). |
| `AUTH_URL` | [Auth wiring](#2-auth-wiring-authjs-clerk) | Auth.js callback origin (alias `NEXTAUTH_URL`). |
| `FLUX_API_BASE` | [CLI](#3-driving-the-cli) | Control plane dashboard API origin + `/api`. |
| `FLUX_API_TOKEN` | [CLI](#3-driving-the-cli) | Personal API token for the CLI. |
| `FLUX_BEARER_TOKEN` | [Wiring your app](#1-wiring-your-app-to-a-flux-project) | Pre-minted JWT for scripts/CI that don't sign at request time. |
| `FLUX_DASHBOARD_BASE` | [CLI](#3-driving-the-cli) | Override for dashboard web origin (rarely needed). |
| `FLUX_DEBUG` | [CLI](#3-driving-the-cli) | Verbose CLI logging. |
| `FLUX_DEFAULT_MODE` | [CLI](#3-driving-the-cli) | Default engine for `flux create` (`v1_dedicated` / `v2_shared`). |
| `FLUX_GATEWAY_JWT_SECRET` | [Wiring your app](#1-wiring-your-app-to-a-flux-project) | Per-project HS256 secret your app uses to sign Flux JWTs. |
| `FLUX_POSTGREST_SCHEMA` | [Wiring your app](#1-wiring-your-app-to-a-flux-project) | `t_<shortid>_api` for direct-to-PostgREST callers (bypassing the gateway). |
| `FLUX_SERVICE_URL` | [Wiring your app](#1-wiring-your-app-to-a-flux-project) | Legacy alias for `FLUX_URL`. |
| `FLUX_URL` | [Wiring your app](#1-wiring-your-app-to-a-flux-project) | Server-side Service URL. |
| `NEXT_PUBLIC_FLUX_URL` | [Wiring your app](#1-wiring-your-app-to-a-flux-project) | Browser-exposed Service URL. |
| `NODE_EXTRA_CA_CERTS` | [TLS and runtime](#5-tls-and-runtime) | Trust a private CA without weakening all HTTPS. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | [TLS and runtime](#5-tls-and-runtime) | TLS escape hatch — don't. |
| `PGRST_DB_ANON_ROLE` | [PostgREST envs](#4-postgrest-container-envs-v1_dedicated-only) | PostgREST role for unauthenticated requests (dedicated only). |
| `PGRST_DB_SCHEMAS` | [PostgREST envs](#4-postgrest-container-envs-v1_dedicated-only) | Schemas PostgREST exposes (dedicated only). |
| `PGRST_DB_URI` | [PostgREST envs](#4-postgrest-container-envs-v1_dedicated-only) | PostgREST → Postgres connection string (dedicated only). |
| `PGRST_JWT_SECRET` | [PostgREST envs](#4-postgrest-container-envs-v1_dedicated-only) | PostgREST JWT verification key (dedicated only). |

## Self-hosted operators

If you run your own Flux install you also have platform-side variables (gateway secrets, system database URLs, container limits, the optional bot User-Agent denylist, etc.) that customers of a hosted Flux never need to know about. Those live in [Production hardening](/docs/guides/production-hardening) so they don't crowd this page.

## Next steps

- [Service URLs](/docs/concepts/service-urls) — the canonical hostname your app calls.
- [JWT authentication](/docs/concepts/jwt-auth) — what `FLUX_GATEWAY_JWT_SECRET` actually signs.
- [Project secrets](/docs/security/project-secrets) — rotation guidance for the secrets above.
- [First request](/docs/getting-started/first-request) — the smallest end-to-end check that all of the above is wired correctly.
