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

Clerk JWTs include a `sub` claim (stable user id). PostgREST exposes JWT claims to PostgreSQL via settings such as `request.jwt.claim.sub`.

Run the following with the Flux CLI (replace `your-slug` and table/column names to match your schema):

```sql
-- Enable RLS
ALTER TABLE api.posts ENABLE ROW LEVEL SECURITY;

-- Policy: each user only sees rows where user_id matches the JWT "sub" claim
CREATE POLICY "Users can only see their own posts"
ON api.posts
FOR SELECT
USING (
  user_id::text = current_setting('request.jwt.claim.sub', true)
);
```

Notes:

- Adjust `user_id` type/casts if your column is `uuid` or `text`; the important part is comparing to `request.jwt.claim.sub`.
- PostgREST does not ship Supabase’s `auth.uid()` helper; `current_setting('request.jwt.claim.sub', true)` is the standard way to read the subject claim in SQL.
- Apply policies for `INSERT` / `UPDATE` / `DELETE` as needed, and grant table privileges to `anon` / `authenticated` per your threat model.

Push the SQL file:

```bash
flux push ./rls-posts.sql -p your-slug
```

After schema changes, PostgREST reloads the schema cache; if something looks stale, restart the project containers from the dashboard or CLI.
