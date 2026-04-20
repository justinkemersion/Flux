# Clerk + Flux (PostgREST) integration

Flux runs [PostgREST](https://postgrest.org/) for each project. PostgREST verifies incoming JWTs using `PGRST_JWT_SECRET`. If that secret matches the key Clerk uses to sign session tokens (or a dedicated JWT template), your API can trust `Authorization: Bearer …` from the browser.

## 1. Get a signing key from Clerk

1. Open the [Clerk Dashboard](https://dashboard.clerk.com/) and select your application.
2. Go to **Configure** → **JWT templates** (or **Sessions** / **JWT templates**, depending on Clerk’s UI version).
3. Create or select a template you will use for your backend (e.g. a custom template aimed at your Flux API).
4. Copy the **Signing key** (sometimes labeled similarly for the template or session JWT). This is the symmetric secret Clerk uses for HS256-style signing.

You will paste this value into Flux as the JWT secret—not the Clerk *publishable* key.

## 2. Paste the secret into Flux

1. Open the Flux dashboard and go to **Projects**.
2. Open **Project settings** (gear icon) for the project that backs your API.
3. In **JWT secret / webhook secret**, paste the Clerk **Signing key** you copied.
4. Click **Save settings**.

Flux updates the PostgREST container’s `PGRST_JWT_SECRET` and recreates the API container so the new secret takes effect immediately. Refresh the project card if needed; **Anon key** and **Service role key** are re-derived from the same secret and will change after you save.

## 3. Send Clerk tokens to PostgREST

Configure your frontend (or BFF) to attach the Clerk session JWT when calling your Flux URL:

```http
GET /api/posts
Host: your-slug.flux.localhost
Authorization: Bearer <clerk_session_jwt>
```

PostgREST validates the JWT with the shared secret and runs queries using the roles you defined at provision time (`anon`, `authenticated`, etc.).

## 4. Row Level Security (RLS) with Clerk’s `sub` claim

Clerk JWTs include a `sub` claim (stable user id). PostgREST exposes the full JWT payload to PostgreSQL as **`request.jwt.claims`** (JSON). Flux’s bootstrap defines **`auth.uid()`** to return that claim’s **`sub` as `text`**, matching Supabase-style policies and supporting Clerk / NextAuth string IDs (not only UUIDs).

Run the following with the Flux CLI (replace `your-slug` and table/column names to match your schema):

```sql
-- Enable RLS
ALTER TABLE api.posts ENABLE ROW LEVEL SECURITY;

-- Policy: each user only sees rows where user_id matches the JWT "sub" claim
CREATE POLICY "Users can only see their own posts"
ON api.posts
FOR SELECT
USING (user_id = auth.uid());
```

Notes:

- Prefer **`auth.uid()`** for comparisons when `user_id` is `text` (typical for Clerk). If a column is still `uuid`, use `user_id::text = auth.uid()` or migrate IDs to `text` (see `packages/cli/migrations/alter-user-id-to-text.sql`).
- You can still read claims directly, e.g. `current_setting('request.jwt.claim.sub', true)`, but **`auth.uid()`** stays aligned with the JSON `sub` from **`request.jwt.claims`**.
- Apply policies for `INSERT` / `UPDATE` / `DELETE` as needed, and grant table privileges to `anon` / `authenticated` per your threat model.

## 5. Profiles row on first use (upsert template)

Many apps expect a row in **`api.profiles`** (or `public.profiles`) keyed by the authenticated user id the first time they touch the API. Without Supabase Auth triggers, use one of these patterns.

**Option A — RPC the client calls once after login** (simplest with PostgREST):

```sql
CREATE OR REPLACE FUNCTION api.ensure_user_profile()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = api, pg_temp
AS $flux$
  INSERT INTO api.profiles (id, updated_at)
  VALUES (auth.uid(), now())
  ON CONFLICT (id) DO UPDATE SET updated_at = excluded.updated_at;
$flux$;

REVOKE ALL ON FUNCTION api.ensure_user_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.ensure_user_profile() TO authenticated;
```

Call it from the app (e.g. `POST /rpc/ensure_user_profile` with a valid JWT). Adjust column lists to match your `profiles` table.

**Option B — trigger on first write to another table** (e.g. ensure profile exists before inserting a post):

```sql
CREATE OR REPLACE FUNCTION api.ensure_profile_before_post()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = api
AS $flux$
BEGIN
  INSERT INTO api.profiles (id)
  VALUES (auth.uid())
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$flux$;

DROP TRIGGER IF EXISTS ensure_profile_before_post ON api.posts;
CREATE TRIGGER ensure_profile_before_post
  BEFORE INSERT ON api.posts
  FOR EACH ROW
  EXECUTE FUNCTION api.ensure_profile_before_post();
```

Replace **`api.posts`** with your real table; add **`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`** and policies as needed.

## 6. Push SQL with the Flux CLI

```bash
flux push ./rls-posts.sql -p your-slug
```

After schema changes, PostgREST reloads the schema cache; if something looks stale, restart the project containers from the dashboard or CLI.
