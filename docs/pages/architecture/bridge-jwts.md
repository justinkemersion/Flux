---
title: Bridge JWTs
description: Short-lived internal JWTs from the gateway to PostgREST on v2 shared.
section: architecture
---

# Bridge JWTs

A **bridge JWT** is minted by the **Flux gateway** after it validates your external **project JWT**. PostgREST trusts this internal token to select the correct **database role** and enforce schema visibility.

## What you will learn

- Why apps should not forge bridge tokens
- What claims typically matter downstream
- TTL and rotation expectations at a high level

## The idea

Apps never handle bridge secrets directly—the gateway holds signing material for the internal step. Your integration surface remains the IdP-issued token the gateway accepts.

**Project JWT contract (v2_shared):** Mint HS256 tokens with your per-project `jwt_secret`. Include a stable **`sub`** for RLS. The inbound **`role`** claim may be `authenticated` (Foundry / Supabase style); the gateway **does not forward** that claim. After verification it mints a bridge JWT whose **`role`** is always **`t_<shortId>_role`** (same short id as `t_<shortId>_api`), plus **`tenant_id`** and the preserved **`sub`**.

The behavior above is versioned as **`FLUX_GATEWAY_CONTRACT_VERSION`** (currently `1.0.0`), exported from `@flux/gateway` alongside `FLUX_GATEWAY_CONTRACT_INVARIANTS`. Downstream doctor tooling can assert against it instead of hard-coding strings.

Short TTLs limit exposure if a token were mis-issued; clients should refresh external tokens normally.

## Pooled push SQL adaptation

The same contract version covers how pooled push adapts application SQL, so there is one version to assert against rather than two.

`authenticated` is an **app-source compatibility token**, not a role that exists on the shared cluster. Write migrations against it and v2_shared pooled push maps it to the tenant runtime role at execution time:

| Source SQL | Executed as |
| --- | --- |
| `GRANT … TO authenticated` | `GRANT … TO "t_<shortId>_role"` |
| `REVOKE … FROM authenticated` | `REVOKE … FROM "t_<shortId>_role"` |
| `ALTER DEFAULT PRIVILEGES … TO authenticated` | `… TO "t_<shortId>_role"` |
| `CREATE POLICY … TO authenticated` | `CREATE POLICY … TO "t_<shortId>_role"` |
| `GRANT/REVOKE … ON SCHEMA public` | `… ON SCHEMA "t_<shortId>_api"` |
| `ALTER DEFAULT PRIVILEGES IN SCHEMA public` | `… IN SCHEMA "t_<shortId>_api"` |

Rules that follow from this:

- **Prefer `TO authenticated` over omitting the `TO` clause.** A policy with no `TO` clause is `TO PUBLIC`: still valid, but broader than intended, and it is not the canonical pattern.
- **Do not create role-membership bridges.** `GRANT authenticated TO t_<shortId>_role` is unnecessary — adaptation already targets the runtime role, and the shared cluster does not provision an `authenticated` role. Historical migrations that added such a bridge are ledgered and must stay immutable; do not edit or re-run them.
- **Adaptation only touches executable SQL.** Line comments, block comments, single-quoted strings, quoted identifiers and dollar-quoted bodies are never rewritten, so `EXECUTE format('grant authenticated to %I', r)` and prose in `--` comments keep their original text.
- **Dynamic DDL must resolve the role itself.** Because function bodies and string literals are left alone, SQL built inside a `DO` block should use `current_schema()` / `%I` to derive `t_<shortId>_role` rather than relying on the adapter reaching inside the literal.
- Qualified `public.<object>` references are left intact: on the shared cluster `public` holds PostgREST hook functions and operator-installed extensions.
- Checksums and ledger rows are computed on pre-adapt file content; adaptation runs at execution only.

## How it works

```txt
Project JWT (IdP) → Gateway verifies → Bridge JWT (PostgREST) → Postgres role
```

Postgres then applies **GRANT**s and optional **RLS** under that role.

## Example

The bridge boundary explains the `401` vs `403` split: `401` with `{ "error": "authorization required" }` means the gateway resolved the tenant host but refused the request before minting a bridge JWT (missing/empty/invalid project Bearer). This is the expected response for unauthenticated access to protected resources such as `GET /rest/v1/profiles`. `403` means the bridge JWT was minted and the request reached PostgreSQL, where the role lacked `GRANT` (RLS would have returned an empty array, not an error). [Troubleshooting](/docs/reference/troubleshooting) walks both cases with verification steps.

## Next steps

- [JWT authentication](/docs/concepts/jwt-auth)
- [Project secrets](/docs/security/project-secrets)
- [Troubleshooting](/docs/reference/troubleshooting)
