# SSH port forwards for local `@flux/gateway` dev

Use this when Postgres, PostgREST, and Redis on your VPS are **not** reachable from your laptop on the public internet (normal). You forward remote loopback ports to local ports, then point `packages/gateway/.env` at `127.0.0.1`.

## 1. Pick local ports (avoid clashes)

If you already run Postgres or Redis locally, use high ports:

| Remote (on VPS) | Suggested local bind |
|-------------------|------------------------|
| `127.0.0.1:5432`  | `127.0.0.1:15432`      |
| `127.0.0.1:3001`  | `127.0.0.1:13001`      |
| `127.0.0.1:6379`  | `127.0.0.1:16379`      |

## 2. Open the tunnel (separate terminal, leave running)

Load your SSH key if needed (`ssh-add …`), then:

```bash
ssh -N \
  -L 127.0.0.1:15432:127.0.0.1:5432 \
  -L 127.0.0.1:13001:127.0.0.1:3001 \
  -L 127.0.0.1:16379:127.0.0.1:6379 \
  root@178.104.205.138
```

- `-N` means “no remote shell”, only forwards.
- If your SSH user or host differs, adjust `root@178.104.205.138`.

**If services listen only inside Docker** on the VPS, the remote side of `-L` must match where they are bound on the **host** (often still `127.0.0.1:<published-port>`). Check on the server with `docker ps` / `ss -lntp` and adjust the middle target if needed.

## 3. Point `packages/gateway/.env` at localhost

While the tunnel is up, set (example — keep your real password and secret values):

```env
FLUX_SYSTEM_DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@127.0.0.1:15432/postgres
FLUX_POSTGREST_POOL_URL=http://127.0.0.1:13001
REDIS_URL=redis://127.0.0.1:16379
FLUX_BASE_DOMAIN=vsl-base.com
```

Do **not** commit `.env`; it stays local.

## 4. Verify before starting the gateway

With the tunnel running:

```bash
# Postgres
psql "postgresql://postgres:YOUR_PASSWORD@127.0.0.1:15432/postgres" -c "select 1"

# PostgREST (expect HTTP 200 / JSON)
curl -sS -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:13001/"

# Redis (optional)
redis-cli -h 127.0.0.1 -p 16379 ping
```

Then:

```bash
curl -sS "http://127.0.0.1:4000/health"
```

You want `"ok":true` and `"db":"up"` (Redis is reported but DB alone determines `ok` today).

## 5. Run load tests against the local gateway

Use `UPSTREAM_BASE=http://127.0.0.1:4000` and a real tenant `Host` (same as production hostname), e.g. `pnpm perf:gateway:truth-score` with the env vars from [gateway-load-testing.md](gateway-load-testing.md).

## Helper script

See [`packages/gateway/bin/hetzner-tunnel.sh`](../packages/gateway/bin/hetzner-tunnel.sh) — optional wrapper around the `ssh -N` command above.
