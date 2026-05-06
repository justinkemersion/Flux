---
title: Environment variables
description: Operator and app environment variables you will see around Flux deployments.
---

# Environment variables

Flux deployments split **control plane** env (dashboard, CLI) from **data plane** env (PostgREST, gateway, Postgres). Values differ per host—treat this as a checklist, not an exhaustive inventory.

## What you will learn

- CLI operator variables
- Representative gateway / web variables mentioned in `README.md`
- Safe handling patterns

## The idea

### CLI / operator (examples)

| Variable | Role |
|---------|------|
| `FLUX_API_BASE` | Dashboard API origin + `/api` |
| `FLUX_API_TOKEN` | Personal API token for CLI |

### Dashboard / web (examples from repo docs)

| Variable | Role |
|---------|------|
| `FLUX_TENANT_PROBE_GATEWAY_URL` | Internal gateway base for health probes |
| `FLUX_SHARED_POSTGRES_URL` | Shared cluster connection (v2 wiring) |
| Database URLs | Drizzle / control-plane catalog connectivity |

### Data plane (examples)

| Variable | Role |
|---------|------|
| `PGRST_DB_URI` | PostgREST → Postgres |
| `PGRST_JWT_SECRET` | JWT verification at PostgREST |
| `PGRST_DB_SCHEMAS` | Exposed schemas (avoid enumerating all tenants on v2) |

## How it works

Never commit real values; use your orchestrator’s secret store. Client apps should only see **non-secret** URLs in `NEXT_PUBLIC_*`.

## Example

```bash
export FLUX_API_BASE="https://flux.example.com/api"
export FLUX_API_TOKEN="flx_live_…"
```

## Next steps

- [Project secrets](/docs/security/project-secrets)
- `README.md` — deployment-specific lists
