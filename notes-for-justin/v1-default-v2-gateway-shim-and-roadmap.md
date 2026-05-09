# Flux v1 default, v2 gateway path, and roadmap

**Audience:** Justin (ongoing Flux work).  
**Why this exists:** End-to-end testing of `@flux/gateway` against a “v2-shaped” request path required several **manual shims** because product defaults, billing labels, and engine modes are not fully aligned yet. This document records **where we are**, **what we had to do by hand**, and **where we are going**.

---

## Glossary (keep these separate)

| Concept | Meaning |
|--------|---------|
| **Billing / product tier** | e.g. Hobby, Pro — what the customer pays for (dashboard, quotas, support). |
| **`projects.mode` (engine)** | `v1_dedicated` vs `v2_shared` — how the **data plane** is run (containers vs shared cluster). Stored in flux-system Postgres. |

Billing tier and engine mode **are independent** today. Naming in docs or UI (“Pro ⇒ v2”) may be aspirational or placeholder logic — **`projects.mode` is authoritative** for routing behavior described below.

---

## Where we are now (facts)

### Default engine: `v1_dedicated`

- New projects created via the **Web UI** (and typical provision flows) still land on **`v1_dedicated`**: dedicated project Postgres + dedicated PostgREST container (plus Traefik routing), per existing `ProjectManager` / bootstrap SQL.
- That remains the **default** and primary path for real tenants until **v2 shared** provisioning ships end-to-end.

### Gateway behavior: only `v2_shared` is proxied

- The Node gateway (`packages/gateway`) resolves `Host` → tenant from flux-system, then **refuses to proxy** unless `tenant.mode === "v2_shared"`.
- So a normal v1 project **will not** use the gateway for public API traffic until **`projects.mode`** is updated (or provisioning sets it).

### CLI / API placeholder gate (known mismatch with product story)

- Some code paths (e.g. CLI create) may require **Pro** to request `v2_shared`. That is **placeholder privilege logic**, not a final rule that “Pro always means v2” or “v2 is only Pro.” Treat **`projects.mode`** and future engine code as the source of truth.

### What we proved with a dev shim (manual)

To exercise **hostname → resolve → mint JWT → proxy to PostgREST** on a server without full v2 provisioning:

1. **Catalog:** `UPDATE projects SET mode = 'v2_shared' WHERE …` for the test project (slug/hash), then refresh gateway cache (e.g. restart gateway) if resolution is stale.
2. **JWT invariant:** `FLUX_GATEWAY_JWT_SECRET` must **byte-match** `PGRST_JWT_SECRET` on the PostgREST instance whose URL is **`FLUX_POSTGREST_POOL_URL`** — not “some other” API container.
3. **Postgres roles:** The gateway mints JWTs with `role = t_<shortid>_role` (shortid = first 12 hex chars of `tenant_id` UUID, hyphens stripped). The **tenant database** must have that role (and usually `t_<shortid>_api` + grants to `authenticator`). v1 bootstrap SQL creates `anon` / `authenticated` / `api` — it does **not** create `t_<shortid>_role` until **engine-v2** (or equivalent) runs.

### Hard-coded / dev-only aspects (not production shape)

- **`FLUX_POSTGREST_POOL_URL`** was set to **one** project’s internal PostgREST (`http://flux-<hash>-<slug>-api:3000`). In real **v2_shared**, the pool URL targets **shared** PostgREST pool(s), not a single project container.
- Pointing the gateway at one tenant’s `-api` container is useful for **integration smoke**; it does **not** prove multi-tenant pool isolation or shared-cluster economics.

---

## Future map (intent)

Rough north star — ordering and timelines are flexible:

1. **Provisioning**
   - **v2_shared:** Provision tenant schema + role (`t_<shortid>_api`, `t_<shortid>_role`, limits, grants) on the **shared** cluster via `@flux/engine-v2` (or merged engine), not hand SQL.
   - **Default over time:** New free/pro tiers may default to `v2_shared` when pooling is ready; `v1_dedicated` stays for enterprise-style isolation where product requires it.

2. **Gateway + pool**
   - Single **`FLUX_POSTGREST_POOL_URL`** (or future discovery) targeting **actual pool** containers; same JWT secret wired from **one** secret source (compose/env) into gateway **and** pool PostgREST.
   - No per-developer pinning of arbitrary project `-api` hosts in prod config.

3. **Operator / product clarity**
   - Align dashboard copy, CLI flags, and **billing vs `projects.mode`** so “Pro” and “v2” are not ambiguous.
   - Optional: migrations or toggles instead of raw SQL for switching modes in controlled environments.

4. **Safety and observability**
   - Health endpoints, rate limits, and tenant headers (`x-tenant-id`, etc.) already help; extend with structured metrics/alerts around pool saturation and gateway errors.

---

## Quick reference commands (non-secret)

Resolve pool URL vs inspected container:

```bash
grep FLUX_POSTGREST_POOL_URL packages/gateway/.env
docker inspect <postgrest-container> --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^PGRST_|^PGRST_DB_URI='
```

Confirm gateway runtime secret length / reload (conceptually):

```bash
docker exec <gateway-container> printenv FLUX_GATEWAY_JWT_SECRET | wc -c
```

Smoke via gateway locally:

```bash
curl -sS -i -H "Host: api.<slug>.<hash>.<your-base-domain>" "http://127.0.0.1:<gateway-port>/"
```

---

## Related code / docs

- Gateway mode gate & proxy: `packages/gateway/src/app.ts`, `packages/gateway/src/proxy.ts`
- JWT + role naming: `packages/gateway/src/jwt-issuer.ts`, `packages/gateway/src/shortid.ts`
- JWT + pool env: `packages/gateway/.env.example`
- v1 tenant bootstrap: `packages/core/src/index.ts` (`BOOTSTRAP_SQL`, PostgREST env)
- v2 architecture (target contract): `docs/pages/architecture/flux-v2-architecture.md`
- Engine v2 stub: `packages/engine-v2/`
