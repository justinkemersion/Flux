# Flux DB Read-Only Inspection Cheatsheet

Purpose: quick commands to inspect a Flux project database on the server without altering data.

All commands below are read-only (`SELECT`, `\d`, `\dt`) and safe for investigation.

## 1) Connect to the server and identify the project containers

```bash
ssh root@178.104.205.138
cd /srv/platform/flux
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' | rg yeastcoast
```

Expected dedicated v1 names for YeastCoast:

- `flux-ffca33f-yeastcoast-db`
- `flux-ffca33f-yeastcoast-api`

## 2) Open a psql shell inside the dedicated Postgres container

```bash
docker exec -it flux-ffca33f-yeastcoast-db psql -U postgres -d postgres
```

Useful read-only psql meta-commands:

- `\conninfo` - confirm DB/user/host
- `\dn` - list schemas
- `\dt public.*` - list public tables
- `\d+ public.hops` - inspect one table definition
- `\q` - quit

## 3) One-liner read-only SQL checks (no interactive shell)

### List tables in `public`

```bash
docker exec flux-ffca33f-yeastcoast-db psql -U postgres -d postgres -c "
SELECT tablename
FROM pg_catalog.pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;"
```

### Check if `public.hops` exists

```bash
docker exec flux-ffca33f-yeastcoast-db psql -U postgres -d postgres -c "
SELECT to_regclass('public.hops') AS hops_table;"
```

### Count rows in `public.hops` (if table exists)

```bash
docker exec flux-ffca33f-yeastcoast-db psql -U postgres -d postgres -c "
SELECT count(*) AS hops_count FROM public.hops;"
```

### Show latest 20 hop rows

```bash
docker exec flux-ffca33f-yeastcoast-db psql -U postgres -d postgres -c "
SELECT *
FROM public.hops
ORDER BY created_at DESC NULLS LAST
LIMIT 20;"
```

### Show recent row counts for key YeastCoast tables

```bash
docker exec flux-ffca33f-yeastcoast-db psql -U postgres -d postgres -c "
SELECT 'profiles' AS table_name, count(*) FROM public.profiles
UNION ALL
SELECT 'recipes'  AS table_name, count(*) FROM public.recipes
UNION ALL
SELECT 'yeasts'   AS table_name, count(*) FROM public.yeasts
UNION ALL
SELECT 'hops'     AS table_name, count(*) FROM public.hops;"
```

## 4) Verify PostgREST can see the table (HTTP read-only check)

From the server:

```bash
curl -sS "https://api.yeastcoast.ffca33f.vsl-base.com/hops?select=*&limit=5" \
  -H "apikey: <YEASTCOAST_ANON_KEY>" \
  -H "Authorization: Bearer <YEASTCOAST_ANON_KEY>"
```

If this returns an error like `relation "public.hops" does not exist`, schema is missing in the dedicated DB.

## 5) Check what happened right after a repair

```bash
docker logs --tail 100 flux-ffca33f-yeastcoast-db
docker logs --tail 100 flux-ffca33f-yeastcoast-api
```

Look for:

- DB init/restart lines
- PostgREST startup and schema cache load lines
- obvious SQL/auth errors

---

## Safety notes

- Avoid `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE` during inspection.
- `\dt`, `\d`, and `SELECT` are safe.
- For risky debugging, copy SQL to a scratch file first and review before running.
