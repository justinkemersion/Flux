---
title: Move from pooled to dedicated (v2 → v1)
description: How to migrate a v2_shared project to v1_dedicated using the Flux CLI—plan, verify, cut over, and update your app.
---

# Move from pooled to dedicated (v2 → v1)

Suppose you built **Bloom Atelier** on **v2 shared** (pooled Postgres and PostgREST behind the Flux gateway) and you are ready for **v1 dedicated** (your own Postgres and PostgREST containers). Flux can orchestrate that move with **`flux migrate`**.

This page is about **changing execution engine** for an existing project. It is not about SQL schema files—those stay in Git and remain the source of truth; see [Migrations workflow](/docs/guides/migrations).

## What you will learn

- How **`flux migrate`** relates to the **control plane** versus your app’s **Service URL**
- A safe order: **dry run → optional dump-only → staged or full migrate**
- What to change in your app **after** the catalog says **v1_dedicated**
- Why errors mention **`pg_dump`** on the server, not on your laptop

## The idea

**v2 shared** and **v1 dedicated** are both real PostgreSQL-backed stacks; the difference is **where** data lives and **how strong** the isolation boundary is. In practice, **v2 shared** is often where people first learn Flux—free tier, shared cluster, and neighbor load can mean higher latency or tighter limits than a dedicated stack. None of that makes pooled mode a toy; it is a different deployment model.

The **v1** / **v2** labels name **execution strategies** (dedicated containers versus pooled cluster), not a universal “newer is better” ranking. Choose dedicated when isolation, compliance posture, or predictable capacity outweigh the operational simplicity of shared infrastructure.

Teams often start on pooled infrastructure, then move a project to dedicated when policy, risk, or operations call for a container-level boundary. That is a product choice—not a statement that pooled mode is “fake.”

**`flux migrate`** talks to the **control plane API** (`…/api/cli/v1/migrate`), not to your tenant **Service URL** (`https://api--<slug>--<hash>.…`). Your browser and server components call the Service URL for rows; the CLI calls the dashboard API to provision, dump, and flip **`projects.mode`**.

So you need:

1. A working **CLI login** to the same control plane that owns the project.
2. For **hosted** deployments, the CLI can infer **`FLUX_API_BASE`** from **`FLUX_URL`** (or **`NEXT_PUBLIC_FLUX_URL`**) when those point at a **`*.vsl-base.com`** tenant host—see [Installation](/docs/getting-started/installation) and [Environment variables](/docs/reference/env-vars). **Self-hosted** still needs an explicit **`FLUX_API_BASE`** if your Service URL is on a custom domain.
3. **`flux.json`** at the repo root (or **`--project`** / **`--hash`** every time) so the CLI resolves slug and hash consistently.

The control plane runs **`pg_dump`** against the **shared cluster** during migration. That binary must exist **on the host that runs the dashboard**, not merely on your laptop.

## Before you start

- Confirm the project is **`v2_shared`** (`flux list` or the dashboard). **`flux migrate`** refuses other modes.
- Run **`flux login`** successfully against the intended control plane.
- Commit or back up anything you care about; a **full** migrate expects **downtime** while containers are reprovisioned and data is restored.
- Read [Pooled vs dedicated](/docs/concepts/pooled-vs-dedicated) so expectations on isolation and URLs stay aligned.

## Step 1 — Plan without changing anything

From your app repo (where **`flux.json`** lives):

```bash
flux migrate -p bloom-atelier --hash 61d9dff --to v1_dedicated --dry-run
```

Use your real **slug** and **hash** from **`flux list`**. Inspect the printed **`plan`** and **`preflight`** (schemas, table counts, etc.). Fix surprises before you add **`--yes`**.

## Step 2 — Optional: dump-only (still no engine flip)

This asks the control plane to run **`pg_dump`** for the tenant schema and write a file **on the control plane host**. It does **not** switch the project to dedicated by itself.

```bash
flux migrate -p bloom-atelier --hash 61d9dff --to v1_dedicated --dump-only --yes
```

Use this to validate connectivity and tooling (`pg_dump` on the server, shared DB URL) before you accept downtime.

## Step 3 — Staged migrate (data on dedicated, catalog still pooled)

**`--staged`** provisions the dedicated stack and restores from the dump, but **does not** flip **`projects.mode`** to **`v1_dedicated`** yet. Use it when you want to inspect the dedicated database before the public cutover.

```bash
flux migrate -p bloom-atelier --hash 61d9dff --to v1_dedicated --staged --yes
```

Do **not** combine **`--staged`** with **`--new-jwt-secret`**; the catalog secret would no longer match the new stack.

## Step 4 — Full migrate (cut over to v1_dedicated)

When you are ready for the catalog to record **dedicated** and for traffic expectations to follow:

```bash
flux migrate -p bloom-atelier --hash 61d9dff --to v1_dedicated --yes
```

By default the control plane enters **gateway maintenance** for the tenant while work is in flight (omit **`--no-lock-writes`** unless you understand the risk of writes during the move).

After success, **`flux list`** should show the project as **v1_dedicated** and the **Service URL** shape your deployment documents (flattened host is the usual external contract).

### Optional flags (check `flux migrate --help`)

| Flag | Meaning |
|------|--------|
| **`--new-jwt-secret`** | Rotate **`jwt_secret`** on cutover; update every client that mints JWTs for PostgREST. |
| **`--drop-source-after`** | After a **non-staged** success, remove the tenant from the **shared** cluster—**destructive**; only when you are sure dedicated is authoritative. |

## After migration — update Bloom’s environment

1. Refresh **`NEXT_PUBLIC_FLUX_URL`** / **`FLUX_URL`** (and any server-only base URL) from **`flux list`** or the dashboard if the Service URL or routing identity changed.
2. If you rotated secrets, run **`flux project credentials`** (or the dashboard) and paste the new **`FLUX_GATEWAY_JWT_SECRET`** (or equivalent) into your env files.
3. Dedicated stacks expose your tenant API schema as provisioned; if you previously targeted **`t_<shortId>_api`** only on v2, re-read [Service URLs](/docs/concepts/service-urls) and your RLS **`GRANT`**s—**RLS without grants** still yields **`42501`**.

Re-run your smoke tests (`curl` or app E2E) before you announce cutover.

## Troubleshooting

- **`pg_dump` not found** on the control plane: the dashboard container must ship **`pg_dump`** (Alpine **`postgresql*-client`** in `apps/dashboard/Dockerfile`). If you still see this after a deploy, confirm you rebuilt **`flux-web`** (`bin/deploy-web.sh`), not only restarted an old image. Your laptop having **`pg_dump`** does not affect migrate—the API handler runs on the server.
- **`invalid command \restrict`** during restore: newer **`pg_dump`** can emit psql meta-commands **`\\restrict`** and **`\\unrestrict`** that older **`psql`** inside the tenant Postgres image rejects. Flux strips those lines when the dedicated server reports a major version **before 17**, and runs **`replaceTenantApiSchemaFromPlainSqlFile`** restores through the same prepared-dump path as **`importSqlFile`**. Deploy an updated **`flux-web`** build, then retry **`--staged`** or full migrate.
- **`Request failed` / wrong project**: confirm **`FLUX_API_BASE`** points at **your** dashboard **`/api`** origin, not only at the tenant API host.
- **Slug/hash mismatch**: align **`flux.json`** with **`flux list`** for the same token.

## Next steps

- [Pooled vs dedicated](/docs/concepts/pooled-vs-dedicated)
- [Migrations workflow](/docs/guides/migrations) (SQL **`flux push`**)
- [Configuration](/docs/reference/config) (**`flux.json`**)
- [CLI reference](/docs/reference/cli)
