# Flux operations: namespaced project rebuild (Hetzner)

Technical runbook for recreating a **namespaced** Flux project (for example **YeastCoast**) on a remote Docker host (for example **Hetzner**) with minimal surprises. Work in order; do not skip confirmation steps.

**Scope:** Control plane from your laptop (or CI) targeting the fleet with `DOCKER_HOST`, Clerk JWT alignment, schema + data migration, frontend env sync, and identity backfill SQL.

---

## Phase 1: The Pre-Flight Check

- [ ] **Generate a master symmetric key (hex)** — one secret for this rotation; you will paste the same value into Clerk and Flux.

```bash
openssl rand -hex 32
```

- [ ] **Clerk — JWT template `flux`**  
  In the [Clerk Dashboard](https://dashboard.clerk.com/) → your application → **JWT templates** → open or create the template named **`flux`** (or the template your app uses for PostgREST).

- [ ] Set the template’s **signing key** to the **same** hex string you generated (HS256-style symmetric secret). This is **not** the Clerk publishable key.

- [ ] Record the value in a password manager or sealed operator notes until Phase 4 — treat it like a production secret.

**Murphy-proofing:** If Clerk and `PGRST_JWT_SECRET` ever diverge, PostgREST will reject valid-looking browser tokens and you will chase ghosts in CORS and 401s.

---

## Phase 2: The Clean Sweep (Nuking)

`flux nuke` removes the tenant **Postgres and PostgREST containers**, **deletes the project’s Postgres data volume**, and removes the per-tenant **internal** Docker network (`flux-<hash>-<slug>-net`) when present. That is intentional: you want an empty cluster for a clean provision and import.

- [ ] Point the CLI at the **remote** Docker engine (SSH URL to your Hetzner host).

- [ ] Confirm the project name (slug) — e.g. `yeastcoast`.

```bash
DOCKER_HOST="ssh://root@YOUR_HETZNER_IP" flux nuke YOUR_PROJECT_NAME -y
```

**Example (from internal deploy scripts):**

```bash
export DOCKER_HOST="ssh://root@178.104.205.138"
flux nuke yeastcoast -y
```

- [ ] Wait until the command exits successfully. **All database data for that project is gone** after this step.

---

## Phase 3: Provisioning

- [ ] Set **`FLUX_DOMAIN`** to the apex domain Traefik / ACME use for tenant hostnames (for example `vsl-base.com`).

- [ ] Run **`flux create`** against the same `DOCKER_HOST`.

```bash
DOCKER_HOST="ssh://root@YOUR_HETZNER_IP" FLUX_DOMAIN="your-apex-domain.com" flux create YOUR_PROJECT_NAME
```

**Example:**

```bash
export DOCKER_HOST="ssh://root@178.104.205.138"
export FLUX_DOMAIN="vsl-base.com"
flux create yeastcoast
```

### Namespacing hash (why the API URL moved)

Flux stacks are **owner-scoped**: container names and the public PostgREST hostname include a **short hex suffix** derived from the provision owner key (`getTenantSuffix` — MD5 slice). The public API host is shaped like:

`https://api.<slug>.<tenantSuffix>.<FLUX_DOMAIN>`

(not the older two-label `api.<slug>.<domain>` pattern when namespacing is in play).

- [ ] **Read the CLI output / logs** after `flux create` and note the printed **gateway API URL** (or run `flux list` with the same `DOCKER_HOST`). **Do not assume** the URL from a previous deploy — after nuke + create, **Traefik host rules and URLs can change** with the suffix.

- [ ] Copy the **exact** `https://api....` base URL — you will need it for Phase 7 (`NEXT_PUBLIC_SUPABASE_URL` / app config).

---

## Phase 4: The Security Handshake

PostgREST verifies JWTs with **`PGRST_JWT_SECRET`**. It must match the Clerk **`flux`** template signing key from Phase 1.

- [ ] Push the secret into the **API container** env. Flux **recreates** the PostgREST container so the new secret applies (new JWT “lock”).

```bash
DOCKER_HOST="ssh://root@YOUR_HETZNER_IP" \
  flux env set "PGRST_JWT_SECRET=PASTE_PHASE_1_HEX" --project YOUR_PROJECT_NAME
```

**Example:**

```bash
flux env set "PGRST_JWT_SECRET=abcdef0123..." -p yeastcoast
```

(`-p` is equivalent to `--project`.)

- [ ] **Expect anon/service JWTs to change** after this — old keys from before the rotation are invalid. Phase 7 will refresh the anon key in the frontend env.

---

## Phase 5: Database Architecture (Schema)

Apply your **Flux-ready** schema (tables in **`api`**, user references as **`text`**) using **`flux push`**, which runs the SQL **inside** the tenant Postgres container via the Docker API.

- [ ] Path to your cleaned SQL file (example name only):

```bash
DOCKER_HOST="ssh://root@YOUR_HETZNER_IP" \
  flux push /path/to/flux_ready.sql -p YOUR_PROJECT_NAME
```

**Non-negotiables for Clerk + PostgREST:**

- [ ] Application tables live in schema **`api`** (Flux PostgREST exposes `api` by default).
- [ ] **User ID columns are `text`**, not `uuid`, so JWT `sub` values (for example `user_2abc...`) store cleanly and match `auth.uid()` in RLS.

If you are porting from Supabase-style `public` + UUIDs, plan **`move_to_api.sql`** / **`alter-user-id-to-text.sql`** in Phase 6 after your base import path.

---

## Phase 6: Data Migration

**Goal:** Load legacy data, then make the **cargo** (rows) match the **ship** (Flux `api` + `text` user IDs).

### Stream the dump into the tenant

`flux push` applies a SQL file in the container — suitable for **plain SQL dumps** and migration scripts. For large Supabase-style dumps, see also **`docs/guides/postgresql-import-to-flux.md`** (`--supabase-compat` / `-s` when appropriate).

```bash
# Example: full dump
DOCKER_HOST="ssh://root@YOUR_HETZNER_IP" \
  flux push /path/to/data_dump.sql -p YOUR_PROJECT_NAME

# Supabase-oriented dump (when using Flux’s compatibility path)
# flux push /path/to/dump.sql -p YOUR_PROJECT_NAME --supabase-compat
```

### Structural migrations (public → api, IDs to text)

From the repo root (paths may vary); order matters if tables still sit in `public` or use UUID user columns:

```bash
DOCKER_HOST="ssh://root@YOUR_HETZNER_IP" \
  flux push packages/cli/migrations/move_to_api.sql -p YOUR_PROJECT_NAME

DOCKER_HOST="ssh://root@YOUR_HETZNER_IP" \
  flux push packages/cli/migrations/alter-user-id-to-text.sql -p YOUR_PROJECT_NAME
```

- [ ] Confirm **`flux push`** exits **0** — it runs with `ON_ERROR_STOP`; partial applies are not silent success.

---

## Phase 7: The Frontend Handshake (The Murphy Trap)

After **`PGRST_JWT_SECRET`** changes, **anon and service_role JWTs are derived from the new secret**. Any `.env` still holding **old** keys will produce 401s or client errors that look like “API down.”

### Retrieve the new anon key

```bash
DOCKER_HOST="ssh://root@YOUR_HETZNER_IP" flux keys YOUR_PROJECT_NAME
```

- [ ] Copy the **anon** JWT (and service role if your server uses it) from the output.

### Update the server-side frontend env (Hetzner)

- [ ] SSH to the host that runs the app stack (example: app lives under `/srv/apps/your-app`).

- [ ] Edit **`.env.docker`** (or your canonical env file for Compose) and set at minimum:

  - [ ] **`NEXT_PUBLIC_SUPABASE_URL`** — the **new** base URL from Phase 3 (**no** `/rest/v1` suffix on the env value; the Supabase client adds the path).
  - [ ] **`NEXT_PUBLIC_SUPABASE_ANON_KEY`** — the **new** anon JWT from `flux keys`.

- [ ] Save the file on the server.

### Golden Rule: hard rebuild

Exact command for a **no-cache image rebuild** and **recreate** of containers (run from the directory that contains `compose.yaml` / `docker-compose.yml`):

```bash
docker compose --env-file .env.docker build --no-cache && docker compose up -d
```

**Murphy-proofing:** If Compose variable substitution for `up` does not pick up `.env.docker`, use the same `--env-file .env.docker` on **`docker compose up`** (some production scripts pass it on both commands). Verify containers restarted with the new env: `docker compose ps` and inspect logs if requests still fail.

---

## Phase 8: Identity Alignment

Existing rows may still carry **old** Clerk user IDs (or Supabase UUIDs). Align **`user_id`** (and similar columns) to the **current** Clerk `sub` for each real user.

- [ ] Obtain the live Clerk user id(s) (for example `user_2lKp...`) from the Clerk dashboard or your auth session.

- [ ] Run **targeted** SQL in the tenant DB via `flux push` on a small patch file, or use your usual SQL path. Example pattern for a `recipes` table:

```sql
UPDATE api.recipes
SET user_id = 'user_2lKpREPLACE_WITH_REAL_CLERK_SUB'
WHERE user_id = 'legacy-or-old-value';
```

- [ ] Repeat per user or batch with a mapping table as appropriate — **do not** blindly set all rows to one id unless that is truly intended.

- [ ] Verify RLS: authenticated requests with a real session JWT should only see rows whose `user_id` matches `auth.uid()` (see **`docs/guides/clerk-integration.md`**).

---

## Quick verification checklist (end-to-end)

- [ ] `flux list` (with `DOCKER_HOST`) shows the project and **correct `apiUrl`**.
- [ ] `flux keys YOUR_PROJECT_NAME` matches what is in **`.env.docker`** on the app host.
- [ ] Browser or curl against `https://api.<slug>.<suffix>.<domain>/` with `apikey` + `Authorization: Bearer <Clerk JWT>` returns expected data.
- [ ] Frontend hard-rebuilt after env change (Phase 7).

---

## Related documentation

- [`docs/guides/clerk-integration.md`](guides/clerk-integration.md) — JWTs, `auth.uid()`, RLS.
- [`docs/guides/postgresql-import-to-flux.md`](guides/postgresql-import-to-flux.md) — dumps, `flux push` flags, version pitfalls.
