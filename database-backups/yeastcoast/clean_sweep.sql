--
-- PostgreSQL database dump
--

-- Dumped from database version 16.2
-- Dumped by pg_dump version 16.2

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

DROP POLICY IF EXISTS public_read ON api.recipes;
DROP POLICY IF EXISTS profiles_public_read ON api.profiles;
DROP POLICY IF EXISTS profiles_owner_update ON api.profiles;
DROP POLICY IF EXISTS profiles_owner_insert ON api.profiles;
DROP POLICY IF EXISTS owner_update ON api.recipes;
DROP POLICY IF EXISTS owner_update ON api.batches;
DROP POLICY IF EXISTS owner_read ON api.recipes;
DROP POLICY IF EXISTS owner_read ON api.batches;
DROP POLICY IF EXISTS owner_insert ON api.recipes;
DROP POLICY IF EXISTS owner_insert ON api.batches;
DROP POLICY IF EXISTS owner_delete ON api.recipes;
DROP POLICY IF EXISTS owner_delete ON api.batches;
DROP POLICY IF EXISTS equipment_update_own ON api.equipment;
DROP POLICY IF EXISTS equipment_select_own ON api.equipment;
DROP POLICY IF EXISTS equipment_insert_own ON api.equipment;
DROP POLICY IF EXISTS brew_logs_public_read ON api.brew_logs;
DROP POLICY IF EXISTS brew_logs_owner_update ON api.brew_logs;
DROP POLICY IF EXISTS brew_logs_owner_delete ON api.brew_logs;
DROP POLICY IF EXISTS brew_logs_auth_insert ON api.brew_logs;
DROP POLICY IF EXISTS brew_log_comments_public_read ON api.brew_log_comments;
DROP POLICY IF EXISTS brew_log_comments_owner_update ON api.brew_log_comments;
DROP POLICY IF EXISTS brew_log_comments_owner_delete ON api.brew_log_comments;
DROP POLICY IF EXISTS brew_log_comments_auth_insert ON api.brew_log_comments;
DROP POLICY IF EXISTS "Yeasts are readable by everyone" ON api.yeasts;
DROP POLICY IF EXISTS "Users update own shopping list" ON api.shopping_list_items;
DROP POLICY IF EXISTS "Users update own inventory" ON api.inventory;
DROP POLICY IF EXISTS "Users update own grain inventory" ON api.user_grain_inventory;
DROP POLICY IF EXISTS "Users read own shopping list" ON api.shopping_list_items;
DROP POLICY IF EXISTS "Users read own inventory" ON api.inventory;
DROP POLICY IF EXISTS "Users read own grain inventory" ON api.user_grain_inventory;
DROP POLICY IF EXISTS "Users insert own shopping list" ON api.shopping_list_items;
DROP POLICY IF EXISTS "Users insert own inventory" ON api.inventory;
DROP POLICY IF EXISTS "Users insert own grain inventory" ON api.user_grain_inventory;
DROP POLICY IF EXISTS "Users delete own shopping list" ON api.shopping_list_items;
DROP POLICY IF EXISTS "Users delete own inventory" ON api.inventory;
DROP POLICY IF EXISTS "Users delete own grain inventory" ON api.user_grain_inventory;
DROP POLICY IF EXISTS "Hops are readable by everyone" ON api.hops;
DROP POLICY IF EXISTS "Grains readable by everyone" ON api.grains;
ALTER TABLE IF EXISTS ONLY api.user_grain_inventory DROP CONSTRAINT IF EXISTS user_grain_inventory_user_id_fkey;
ALTER TABLE IF EXISTS ONLY api.user_grain_inventory DROP CONSTRAINT IF EXISTS user_grain_inventory_grain_id_fkey;
ALTER TABLE IF EXISTS ONLY api.shopping_list_items DROP CONSTRAINT IF EXISTS shopping_list_items_user_id_fkey;
ALTER TABLE IF EXISTS ONLY api.shopping_list_items DROP CONSTRAINT IF EXISTS shopping_list_items_recipe_id_fkey;
ALTER TABLE IF EXISTS ONLY api.recipes DROP CONSTRAINT IF EXISTS recipes_forked_from_id_fkey;
ALTER TABLE IF EXISTS ONLY api.inventory DROP CONSTRAINT IF EXISTS inventory_user_id_fkey;
ALTER TABLE IF EXISTS ONLY api.equipment DROP CONSTRAINT IF EXISTS equipment_user_id_fkey;
ALTER TABLE IF EXISTS ONLY api.brew_logs DROP CONSTRAINT IF EXISTS brew_logs_author_id_fkey;
ALTER TABLE IF EXISTS ONLY api.brew_log_comments DROP CONSTRAINT IF EXISTS brew_log_comments_log_id_fkey;
ALTER TABLE IF EXISTS ONLY api.brew_log_comments DROP CONSTRAINT IF EXISTS brew_log_comments_author_id_fkey;
ALTER TABLE IF EXISTS ONLY api.batches DROP CONSTRAINT IF EXISTS batches_recipe_id_fkey;
DROP TRIGGER IF EXISTS recipes_set_updated_at ON api.recipes;
DROP TRIGGER IF EXISTS profiles_freeze_public_code ON api.profiles;
DROP TRIGGER IF EXISTS profiles_ensure_public_code ON api.profiles;
DROP TRIGGER IF EXISTS equipment_set_updated_at ON api.equipment;
DROP TRIGGER IF EXISTS brew_logs_set_updated_at ON api.brew_logs;
DROP TRIGGER IF EXISTS batches_set_updated_at ON api.batches;
DROP TRIGGER IF EXISTS batches_refresh_yeast_usage ON api.batches;
DROP INDEX IF EXISTS api.user_grain_inventory_grain_id_idx;
DROP INDEX IF EXISTS api.shopping_list_items_user_id_idx;
DROP INDEX IF EXISTS api.shopping_list_items_recipe_id_idx;
DROP INDEX IF EXISTS api.shopping_list_items_purchased_idx;
DROP INDEX IF EXISTS api.profiles_public_code_key;
DROP INDEX IF EXISTS api.inventory_user_id_idx;
DROP INDEX IF EXISTS api.inventory_item_type_idx;
DROP INDEX IF EXISTS api.idx_yeasts_usage_count;
DROP INDEX IF EXISTS api.idx_recipes_user_id;
DROP INDEX IF EXISTS api.idx_recipes_public_style;
DROP INDEX IF EXISTS api.idx_recipes_public;
DROP INDEX IF EXISTS api.idx_recipes_forked_from;
DROP INDEX IF EXISTS api.idx_equipment_user;
DROP INDEX IF EXISTS api.idx_brew_logs_is_official;
DROP INDEX IF EXISTS api.idx_brew_logs_created_at;
DROP INDEX IF EXISTS api.idx_brew_logs_author_id;
DROP INDEX IF EXISTS api.idx_brew_log_comments_log_id;
DROP INDEX IF EXISTS api.idx_brew_log_comments_author_id;
DROP INDEX IF EXISTS api.idx_batches_user_id;
DROP INDEX IF EXISTS api.idx_batches_recipe_id;
DROP INDEX IF EXISTS api.idx_batches_in_progress;
DROP INDEX IF EXISTS api.brew_logs_author_id_slug_key;
ALTER TABLE IF EXISTS ONLY api.yeasts DROP CONSTRAINT IF EXISTS yeasts_pkey;
ALTER TABLE IF EXISTS ONLY api.yeasts DROP CONSTRAINT IF EXISTS yeasts_code_key;
ALTER TABLE IF EXISTS ONLY api.user_grain_inventory DROP CONSTRAINT IF EXISTS user_grain_inventory_pkey;
ALTER TABLE IF EXISTS ONLY api.shopping_list_items DROP CONSTRAINT IF EXISTS shopping_list_items_pkey;
ALTER TABLE IF EXISTS ONLY api.recipes DROP CONSTRAINT IF EXISTS recipes_pkey;
ALTER TABLE IF EXISTS ONLY api.profiles DROP CONSTRAINT IF EXISTS profiles_pkey;
ALTER TABLE IF EXISTS ONLY api.inventory DROP CONSTRAINT IF EXISTS inventory_user_id_item_type_item_id_key;
ALTER TABLE IF EXISTS ONLY api.inventory DROP CONSTRAINT IF EXISTS inventory_pkey;
ALTER TABLE IF EXISTS ONLY api.hops DROP CONSTRAINT IF EXISTS hops_pkey;
ALTER TABLE IF EXISTS ONLY api.hops DROP CONSTRAINT IF EXISTS hops_name_key;
ALTER TABLE IF EXISTS ONLY api.grains DROP CONSTRAINT IF EXISTS grains_pkey;
ALTER TABLE IF EXISTS ONLY api.grains DROP CONSTRAINT IF EXISTS grains_name_key;
ALTER TABLE IF EXISTS ONLY api.equipment DROP CONSTRAINT IF EXISTS equipment_pkey;
ALTER TABLE IF EXISTS ONLY api.brew_logs DROP CONSTRAINT IF EXISTS brew_logs_pkey;
ALTER TABLE IF EXISTS ONLY api.brew_log_comments DROP CONSTRAINT IF EXISTS brew_log_comments_pkey;
ALTER TABLE IF EXISTS ONLY api.batches DROP CONSTRAINT IF EXISTS batches_pkey;
DROP TABLE IF EXISTS api.yeasts;
DROP TABLE IF EXISTS api.user_grain_inventory;
DROP TABLE IF EXISTS api.shopping_list_items;
DROP TABLE IF EXISTS api.recipes;
DROP TABLE IF EXISTS api.profiles;
DROP TABLE IF EXISTS api.inventory;
DROP TABLE IF EXISTS api.hops;
DROP TABLE IF EXISTS api.grains;
DROP TABLE IF EXISTS api.equipment;
DROP TABLE IF EXISTS api.brew_logs;
DROP TABLE IF EXISTS api.brew_log_comments;
DROP TABLE IF EXISTS api.batches;
DROP FUNCTION IF EXISTS auth.uid();
DROP FUNCTION IF EXISTS api.set_updated_at();
DROP FUNCTION IF EXISTS api.profiles_freeze_public_code();
DROP FUNCTION IF EXISTS api.profiles_ensure_public_code();
DROP FUNCTION IF EXISTS api.profile_username_is_taken(p_candidate text, p_user_id text);
DROP FUNCTION IF EXISTS api.generate_unique_public_code();
DROP FUNCTION IF EXISTS api.ensure_user_profile();
DROP FUNCTION IF EXISTS api.calculate_yeast_usage();
DROP FUNCTION IF EXISTS api.batches_refresh_yeast_usage_on_complete();
DROP SCHEMA IF EXISTS auth;
DROP SCHEMA IF EXISTS api;
--
-- Name: api; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA api;


ALTER SCHEMA api OWNER TO postgres;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA auth;


ALTER SCHEMA auth OWNER TO postgres;

--
-- Name: batches_refresh_yeast_usage_on_complete(); Type: FUNCTION; Schema: api; Owner: postgres
--

CREATE FUNCTION api.batches_refresh_yeast_usage_on_complete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'api'
    AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    IF TG_OP = 'INSERT' THEN
      PERFORM api.calculate_yeast_usage();
    ELSIF OLD.status IS DISTINCT FROM 'completed' THEN
      PERFORM api.calculate_yeast_usage();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION api.batches_refresh_yeast_usage_on_complete() OWNER TO postgres;

--
-- Name: calculate_yeast_usage(); Type: FUNCTION; Schema: api; Owner: postgres
--

CREATE FUNCTION api.calculate_yeast_usage() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'api'
    AS $$
BEGIN
  UPDATE api.yeasts
  SET usage_count = 0;

  UPDATE api.yeasts AS y
  SET usage_count = c.cnt
  FROM (
    SELECT
      t.id,
      COUNT(*)::integer AS cnt
    FROM api.batches AS b
    INNER JOIN api.recipes AS r ON r.id = b.recipe_id
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(r.data #> '{ingredients,yeasts}', '[]'::jsonb)
    ) AS arr(elem)
    INNER JOIN api.yeasts AS t
      ON lower(t.id::text) = lower(btrim(elem->>'id'))
    WHERE b.status = 'completed'
      AND r.is_private = false
      AND elem ? 'id'
      AND btrim(elem->>'id') <> ''
    GROUP BY t.id
  ) AS c
  WHERE y.id = c.id;
END;
$$;


ALTER FUNCTION api.calculate_yeast_usage() OWNER TO postgres;

--
-- Name: FUNCTION calculate_yeast_usage(); Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON FUNCTION api.calculate_yeast_usage() IS 'Sets yeasts.usage_count from completed batches on public recipes (is_private = false), data.ingredients.yeasts[*].id.';


--
-- Name: ensure_user_profile(); Type: FUNCTION; Schema: api; Owner: postgres
--

CREATE FUNCTION api.ensure_user_profile() RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'api', 'pg_temp'
    AS $$
  INSERT INTO api.profiles (id)
  VALUES (auth.uid())
  ON CONFLICT (id) DO NOTHING;
$$;


ALTER FUNCTION api.ensure_user_profile() OWNER TO postgres;

--
-- Name: generate_unique_public_code(); Type: FUNCTION; Schema: api; Owner: postgres
--

CREATE FUNCTION api.generate_unique_public_code() RETURNS text
    LANGUAGE plpgsql
    SET search_path TO 'api'
    AS $$
DECLARE
  chars constant text := '23456789abcdefghjkmnpqrstuvwxyz';
  result text;
  i int;
  safety int := 0;
BEGIN
  LOOP
    result := '';
    FOR i IN 1..5 LOOP
      result := result || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM api.profiles p WHERE p.public_code = result);
    safety := safety + 1;
    IF safety > 200 THEN
      RAISE EXCEPTION 'Could not allocate public_code after 200 attempts';
    END IF;
  END LOOP;
  RETURN result;
END;
$$;


ALTER FUNCTION api.generate_unique_public_code() OWNER TO postgres;

--
-- Name: profile_username_is_taken(text, text); Type: FUNCTION; Schema: api; Owner: postgres
--

CREATE FUNCTION api.profile_username_is_taken(p_candidate text, p_user_id text) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'api'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM api.profiles p
    WHERE p.id <> p_user_id
      AND lower(trim(p.username)) = lower(trim(p_candidate))
  );
$$;


ALTER FUNCTION api.profile_username_is_taken(p_candidate text, p_user_id text) OWNER TO postgres;

--
-- Name: profiles_ensure_public_code(); Type: FUNCTION; Schema: api; Owner: postgres
--

CREATE FUNCTION api.profiles_ensure_public_code() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'api'
    AS $$
BEGIN
  IF NEW.public_code IS NULL OR btrim(NEW.public_code) = '' THEN
    NEW.public_code := api.generate_unique_public_code();
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION api.profiles_ensure_public_code() OWNER TO postgres;

--
-- Name: profiles_freeze_public_code(); Type: FUNCTION; Schema: api; Owner: postgres
--

CREATE FUNCTION api.profiles_freeze_public_code() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.public_code IS NOT NULL
     AND NEW.public_code IS DISTINCT FROM OLD.public_code THEN
    RAISE EXCEPTION 'public_code cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION api.profiles_freeze_public_code() OWNER TO postgres;

--
-- Name: set_updated_at(); Type: FUNCTION; Schema: api; Owner: postgres
--

CREATE FUNCTION api.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION api.set_updated_at() OWNER TO postgres;

--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: postgres
--

CREATE FUNCTION auth.uid() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::text;
$$;


ALTER FUNCTION auth.uid() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: batches; Type: TABLE; Schema: api; Owner: postgres
--

CREATE TABLE api.batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    recipe_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    actual_og numeric(5,3),
    actual_fg numeric(5,3),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    pre_boil_gravity numeric(5,3),
    current_gravity numeric(5,3),
    forecast_ambient_temp_c numeric(5,2),
    fermentation_window_days integer DEFAULT 14 NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT batches_fermentation_window_days_check CHECK (((fermentation_window_days >= 7) AND (fermentation_window_days <= 60))),
    CONSTRAINT batches_status_check CHECK ((status = ANY (ARRAY['active'::text, 'fermenting'::text, 'completed'::text, 'abandoned'::text])))
);


ALTER TABLE api.batches OWNER TO postgres;

--
-- Name: TABLE batches; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON TABLE api.batches IS 'Active and historical brew sessions, one per recipe brew attempt.';


--
-- Name: COLUMN batches.recipe_id; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.batches.recipe_id IS 'The blueprint this batch was brewed from.';


--
-- Name: COLUMN batches.status; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.batches.status IS 'active = Brew Day timer; fermenting = fermentation engine; completed/abandoned = closed.';


--
-- Name: COLUMN batches.actual_og; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.batches.actual_og IS 'Measured original gravity — compared against recipe target.';


--
-- Name: COLUMN batches.actual_fg; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.batches.actual_fg IS 'Measured final gravity — set once fermentation is complete.';


--
-- Name: COLUMN batches.pre_boil_gravity; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.batches.pre_boil_gravity IS 'Measured pre-boil specific gravity — compared against recipe target.';


--
-- Name: COLUMN batches.current_gravity; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.batches.current_gravity IS 'Most recent hydrometer/sample SG during active fermentation (optional).';


--
-- Name: COLUMN batches.forecast_ambient_temp_c; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.batches.forecast_ambient_temp_c IS 'Cellar forecast ambient °C saved from Fermentation Engine for dashboard sync.';


--
-- Name: COLUMN batches.fermentation_window_days; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.batches.fermentation_window_days IS 'User-adjustable horizon (days) for the fermentation twin chart and "window elapsed" UX; default 14.';


--
-- Name: COLUMN batches.completed_at; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.batches.completed_at IS 'Set when status becomes completed; used for history and read-only fermentation recap.';


--
-- Name: brew_log_comments; Type: TABLE; Schema: api; Owner: postgres
--

CREATE TABLE api.brew_log_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    log_id uuid NOT NULL,
    author_id text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE api.brew_log_comments OWNER TO postgres;

--
-- Name: TABLE brew_log_comments; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON TABLE api.brew_log_comments IS 'User comments on Brew Log entries.';


--
-- Name: COLUMN brew_log_comments.log_id; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.brew_log_comments.log_id IS 'FK to brew_logs; comment is deleted when its parent log is deleted.';


--
-- Name: COLUMN brew_log_comments.content; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.brew_log_comments.content IS 'Plain text or Markdown comment body.';


--
-- Name: brew_logs; Type: TABLE; Schema: api; Owner: postgres
--

CREATE TABLE api.brew_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    author_id text NOT NULL,
    title text NOT NULL,
    slug text NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    is_official boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE api.brew_logs OWNER TO postgres;

--
-- Name: TABLE brew_logs; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON TABLE api.brew_logs IS 'Community Brew Logs: user-authored Markdown guides, stories, and methodologies.';


--
-- Name: COLUMN brew_logs.slug; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.brew_logs.slug IS 'URL segment unique per author; full path is /brew-logs/{profiles.public_code}/{slug}.';


--
-- Name: COLUMN brew_logs.content; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.brew_logs.content IS 'Markdown body of the log entry.';


--
-- Name: COLUMN brew_logs.is_official; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.brew_logs.is_official IS 'When true, the entry is YeastCoast-authored and pinned at the top of the listing.';


--
-- Name: equipment; Type: TABLE; Schema: api; Owner: postgres
--

CREATE TABLE api.equipment (
    user_id text NOT NULL,
    profile_name text DEFAULT 'Primary system'::text NOT NULL,
    batch_size_target_l numeric(10,3) DEFAULT 19.0 NOT NULL,
    brewhouse_efficiency_pct numeric(5,2) DEFAULT 72.0 NOT NULL,
    boil_off_l_per_hr numeric(8,3) DEFAULT 3.8 NOT NULL,
    trub_loss_l numeric(8,3) DEFAULT 1.5 NOT NULL,
    last_pbw_clean_at timestamp with time zone,
    lines_flushed_at timestamp with time zone,
    probe_calibrated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT equipment_batch_size_target_l_check CHECK (((batch_size_target_l > (0)::numeric) AND (batch_size_target_l <= (500)::numeric))),
    CONSTRAINT equipment_boil_off_l_per_hr_check CHECK (((boil_off_l_per_hr >= (0)::numeric) AND (boil_off_l_per_hr <= (50)::numeric))),
    CONSTRAINT equipment_brewhouse_efficiency_pct_check CHECK (((brewhouse_efficiency_pct > (0)::numeric) AND (brewhouse_efficiency_pct <= (100)::numeric))),
    CONSTRAINT equipment_trub_loss_l_check CHECK (((trub_loss_l >= (0)::numeric) AND (trub_loss_l <= (50)::numeric)))
);


ALTER TABLE api.equipment OWNER TO postgres;

--
-- Name: TABLE equipment; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON TABLE api.equipment IS 'User brewhouse hardware calibration (batch target L, efficiency, boil-off, trub).';


--
-- Name: COLUMN equipment.batch_size_target_l; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.equipment.batch_size_target_l IS 'Target batch into fermenter (L) — universal scaler baseline.';


--
-- Name: COLUMN equipment.trub_loss_l; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.equipment.trub_loss_l IS 'Kettle loss to trub / hops (L), post-boil.';


--
-- Name: grains; Type: TABLE; Schema: api; Owner: postgres
--

CREATE TABLE api.grains (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    origin text NOT NULL,
    srm numeric(6,2) NOT NULL,
    potential_sg numeric(6,4) NOT NULL,
    yield_pct numeric(5,2) DEFAULT 75.0 NOT NULL,
    diastatic_power text NOT NULL,
    sensory_profile text[] DEFAULT '{}'::text[] NOT NULL,
    substitutes text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grains_diastatic_power_check CHECK ((diastatic_power = ANY (ARRAY['Low'::text, 'Med'::text, 'High'::text]))),
    CONSTRAINT grains_potential_sg_check CHECK (((potential_sg >= 0.9) AND (potential_sg <= 1.2))),
    CONSTRAINT grains_srm_check CHECK ((srm >= (0)::numeric)),
    CONSTRAINT grains_type_check CHECK ((type = ANY (ARRAY['Base'::text, 'Crystal'::text, 'Roasted'::text, 'Adjunct'::text, 'Sugar'::text]))),
    CONSTRAINT grains_yield_pct_check CHECK (((yield_pct >= (0)::numeric) AND (yield_pct <= (100)::numeric)))
);


ALTER TABLE api.grains OWNER TO postgres;

--
-- Name: TABLE grains; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON TABLE api.grains IS 'Global fermentable / malt catalog for Grain Library (read-only for clients).';


--
-- Name: COLUMN grains.potential_sg; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.grains.potential_sg IS 'Max theoretical SG contribution per lb/gal in ideal mash (e.g. 1.036).';


--
-- Name: COLUMN grains.yield_pct; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.grains.yield_pct IS 'Fine-grind dry-basis extract % (typical lab spec range).';


--
-- Name: hops; Type: TABLE; Schema: api; Owner: postgres
--

CREATE TABLE api.hops (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    origin text NOT NULL,
    alpha_acid_min numeric(4,2) NOT NULL,
    alpha_acid_max numeric(4,2) NOT NULL,
    purpose text NOT NULL,
    profile text[] DEFAULT '{}'::text[] NOT NULL,
    substitutes text[] DEFAULT '{}'::text[] NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    form text DEFAULT 'Pellet'::text NOT NULL,
    beta_acid_min numeric(5,2) DEFAULT 3.0 NOT NULL,
    beta_acid_max numeric(5,2) DEFAULT 6.0 NOT NULL,
    total_oil_min numeric(5,2) DEFAULT 0.8 NOT NULL,
    total_oil_max numeric(5,2) DEFAULT 2.0 NOT NULL,
    myrcene_pct numeric(5,2) DEFAULT 35.0 NOT NULL,
    caryophyllene_pct numeric(5,2) DEFAULT 8.0 NOT NULL,
    CONSTRAINT hops_beta_check CHECK (((beta_acid_min >= (0)::numeric) AND (beta_acid_max >= beta_acid_min))),
    CONSTRAINT hops_check CHECK (((alpha_acid_min >= (0)::numeric) AND (alpha_acid_max >= alpha_acid_min))),
    CONSTRAINT hops_form_check CHECK ((form = ANY (ARRAY['Pellet'::text, 'Whole Leaf'::text, 'Cryo'::text]))),
    CONSTRAINT hops_oil_check CHECK (((total_oil_min >= (0)::numeric) AND (total_oil_max >= total_oil_min))),
    CONSTRAINT hops_oil_component_check CHECK (((myrcene_pct >= (0)::numeric) AND (myrcene_pct <= (100)::numeric) AND (caryophyllene_pct >= (0)::numeric) AND (caryophyllene_pct <= (100)::numeric))),
    CONSTRAINT hops_purpose_check CHECK ((purpose = ANY (ARRAY['Bittering'::text, 'Aroma'::text, 'Dual Purpose'::text])))
);


ALTER TABLE api.hops OWNER TO postgres;

--
-- Name: TABLE hops; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON TABLE api.hops IS 'Hop variety encyclopedia; public read, admin/service writes only.';


--
-- Name: COLUMN hops.beta_acid_min; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.hops.beta_acid_min IS 'Beta acids (% w/w) — oxidation stability / foam';


--
-- Name: COLUMN hops.total_oil_min; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.hops.total_oil_min IS 'Total essential oil (mL/100g) — aroma potential';


--
-- Name: COLUMN hops.myrcene_pct; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.hops.myrcene_pct IS 'Approx. share of total oil (green/citrus character)';


--
-- Name: COLUMN hops.caryophyllene_pct; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.hops.caryophyllene_pct IS 'Approx. share of total oil (woody/spicy character)';


--
-- Name: inventory; Type: TABLE; Schema: api; Owner: postgres
--

CREATE TABLE api.inventory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    item_type text NOT NULL,
    item_id uuid NOT NULL,
    quantity numeric(12,4) DEFAULT 0 NOT NULL,
    unit text DEFAULT 'g'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_item_type_check CHECK ((item_type = ANY (ARRAY['hop'::text, 'yeast'::text]))),
    CONSTRAINT inventory_quantity_check CHECK ((quantity >= (0)::numeric))
);


ALTER TABLE api.inventory OWNER TO postgres;

--
-- Name: TABLE inventory; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON TABLE api.inventory IS 'Per-user pantry stock for hops and yeasts. Grain stock uses user_grain_inventory.';


--
-- Name: COLUMN inventory.item_type; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.inventory.item_type IS 'hop | yeast';


--
-- Name: COLUMN inventory.item_id; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.inventory.item_id IS 'FK to hops.id or yeasts.id depending on item_type';


--
-- Name: COLUMN inventory.unit; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.inventory.unit IS 'Storage unit: g / oz for hops; pkg for yeasts';


--
-- Name: profiles; Type: TABLE; Schema: api; Owner: postgres
--

CREATE TABLE api.profiles (
    id text NOT NULL,
    username text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    temp_unit text DEFAULT 'F'::text NOT NULL,
    volume_unit text DEFAULT 'gal'::text NOT NULL,
    weight_unit text DEFAULT 'lb'::text NOT NULL,
    gravity_display text DEFAULT 'sg'::text NOT NULL,
    default_efficiency numeric(5,2) DEFAULT 72 NOT NULL,
    evaporation_l_per_hr numeric(8,3) DEFAULT 3.8 NOT NULL,
    default_batch_size double precision DEFAULT 19.0 NOT NULL,
    public_code text NOT NULL,
    CONSTRAINT profiles_default_batch_size_check CHECK (((default_batch_size > (0)::double precision) AND (default_batch_size <= (500)::double precision))),
    CONSTRAINT profiles_default_efficiency_check CHECK (((default_efficiency > (0)::numeric) AND (default_efficiency <= (100)::numeric))),
    CONSTRAINT profiles_evaporation_check CHECK (((evaporation_l_per_hr >= (0)::numeric) AND (evaporation_l_per_hr <= (50)::numeric))),
    CONSTRAINT profiles_gravity_display_check CHECK ((gravity_display = ANY (ARRAY['sg'::text, 'plato'::text]))),
    CONSTRAINT profiles_temp_unit_check CHECK ((temp_unit = ANY (ARRAY['C'::text, 'F'::text]))),
    CONSTRAINT profiles_volume_unit_check CHECK ((volume_unit = ANY (ARRAY['L'::text, 'gal'::text]))),
    CONSTRAINT profiles_weight_unit_check CHECK ((weight_unit = ANY (ARRAY['kg'::text, 'lb'::text])))
);


ALTER TABLE api.profiles OWNER TO postgres;

--
-- Name: TABLE profiles; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON TABLE api.profiles IS 'Public-facing brewmaster profiles for YeastCoast users.';


--
-- Name: COLUMN profiles.username; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.profiles.username IS 'Display name shown in the public library. Defaults to email prefix.';


--
-- Name: COLUMN profiles.temp_unit; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.profiles.temp_unit IS 'Display / preference: C or F.';


--
-- Name: COLUMN profiles.volume_unit; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.profiles.volume_unit IS 'Preferred volume unit: L or gal.';


--
-- Name: COLUMN profiles.weight_unit; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.profiles.weight_unit IS 'Preferred weight unit: kg or lb.';


--
-- Name: COLUMN profiles.gravity_display; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.profiles.gravity_display IS 'sg (1.xxx) or plato degrees.';


--
-- Name: COLUMN profiles.default_efficiency; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.profiles.default_efficiency IS 'Brewhouse efficiency % default for new recipes.';


--
-- Name: COLUMN profiles.evaporation_l_per_hr; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.profiles.evaporation_l_per_hr IS 'Boil-off calibration (liters per hour).';


--
-- Name: COLUMN profiles.default_batch_size; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.profiles.default_batch_size IS 'Target batch volume in liters for scaling ingredient amounts on the recipe blueprint (user opt-in).';


--
-- Name: COLUMN profiles.public_code; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.profiles.public_code IS 'Stable 5-char identifier for public URLs (e.g. Brew Logs). Immutable after assignment.';


--
-- Name: recipes; Type: TABLE; Schema: api; Owner: postgres
--

CREATE TABLE api.recipes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    name text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_private boolean DEFAULT true NOT NULL,
    forked_from_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    style_id text,
    complexity integer DEFAULT 3 NOT NULL,
    views integer DEFAULT 0 NOT NULL,
    CONSTRAINT recipes_complexity_check CHECK (((complexity >= 1) AND (complexity <= 5))),
    CONSTRAINT recipes_views_check CHECK ((views >= 0))
);


ALTER TABLE api.recipes OWNER TO postgres;

--
-- Name: TABLE recipes; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON TABLE api.recipes IS 'Homebrew recipe blueprints owned by authenticated users.';


--
-- Name: COLUMN recipes.data; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.recipes.data IS 'Full recipe payload (grains, hops, yeast, stats, notes) as JSONB.';


--
-- Name: COLUMN recipes.is_private; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.recipes.is_private IS 'When false the recipe is readable by anyone (community sharing).';


--
-- Name: COLUMN recipes.forked_from_id; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.recipes.forked_from_id IS 'Points to the original recipe if this record was forked from another.';


--
-- Name: COLUMN recipes.style_id; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.recipes.style_id IS 'BJCP-style category code (e.g. 21A, 18B) for library indexing.';


--
-- Name: COLUMN recipes.complexity; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.recipes.complexity IS 'Recipe complexity 1=Baseline … 5=Master (library sort/filter).';


--
-- Name: COLUMN recipes.views; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.recipes.views IS 'Public recipe detail views (increment later via app).';


--
-- Name: shopping_list_items; Type: TABLE; Schema: api; Owner: postgres
--

CREATE TABLE api.shopping_list_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    recipe_id uuid,
    recipe_name text DEFAULT ''::text NOT NULL,
    item_name text NOT NULL,
    item_type text NOT NULL,
    quantity_needed numeric(12,4) DEFAULT 0 NOT NULL,
    unit text DEFAULT 'g'::text NOT NULL,
    is_purchased boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shopping_list_items_item_type_check CHECK ((item_type = ANY (ARRAY['grain'::text, 'hop'::text, 'yeast'::text, 'other'::text]))),
    CONSTRAINT shopping_list_items_quantity_needed_check CHECK ((quantity_needed >= (0)::numeric))
);


ALTER TABLE api.shopping_list_items OWNER TO postgres;

--
-- Name: TABLE shopping_list_items; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON TABLE api.shopping_list_items IS 'User procurement list — generated from PantryCheck diff or added manually.';


--
-- Name: COLUMN shopping_list_items.recipe_id; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.shopping_list_items.recipe_id IS 'Optional — NULL for manually added items.';


--
-- Name: COLUMN shopping_list_items.recipe_name; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.shopping_list_items.recipe_name IS 'Denormalized recipe name for display without joins.';


--
-- Name: COLUMN shopping_list_items.quantity_needed; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.shopping_list_items.quantity_needed IS 'Shortfall only (missing or partial gap), not the full recipe requirement.';


--
-- Name: user_grain_inventory; Type: TABLE; Schema: api; Owner: postgres
--

CREATE TABLE api.user_grain_inventory (
    user_id text NOT NULL,
    grain_id uuid NOT NULL,
    inventory_kg numeric(12,4) DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_grain_inventory_inventory_kg_check CHECK ((inventory_kg >= (0)::numeric))
);


ALTER TABLE api.user_grain_inventory OWNER TO postgres;

--
-- Name: TABLE user_grain_inventory; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON TABLE api.user_grain_inventory IS 'Per-user pantry stock (kg) for grains catalog.';


--
-- Name: yeasts; Type: TABLE; Schema: api; Owner: postgres
--

CREATE TABLE api.yeasts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    lab text NOT NULL,
    code text NOT NULL,
    type text NOT NULL,
    attenuation_min integer NOT NULL,
    attenuation_max integer NOT NULL,
    flocculation text NOT NULL,
    temp_min integer NOT NULL,
    temp_max integer NOT NULL,
    description text,
    styles text[],
    created_at timestamp with time zone DEFAULT now(),
    abv_tolerance numeric(5,1) DEFAULT 11.0 NOT NULL,
    sta1_status boolean DEFAULT false NOT NULL,
    diacetyl_production text DEFAULT 'Low'::text NOT NULL,
    analogues text[] DEFAULT '{}'::text[] NOT NULL,
    usage_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT yeasts_diacetyl_production_check CHECK ((diacetyl_production = ANY (ARRAY['Low'::text, 'Med'::text, 'High'::text]))),
    CONSTRAINT yeasts_flocculation_check CHECK ((flocculation = ANY (ARRAY['Low'::text, 'Medium'::text, 'High'::text, 'Very High'::text]))),
    CONSTRAINT yeasts_type_check CHECK ((type = ANY (ARRAY['Ale'::text, 'Lager'::text, 'Wheat'::text, 'Wild'::text, 'Hybrid'::text])))
);


ALTER TABLE api.yeasts OWNER TO postgres;

--
-- Name: COLUMN yeasts.abv_tolerance; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.yeasts.abv_tolerance IS 'Approximate max ABV (% v/v) before severe stress/stall risk under normal pitch';


--
-- Name: COLUMN yeasts.sta1_status; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.yeasts.sta1_status IS 'STA1 / diastaticus positive — elevated attenuation risk';


--
-- Name: COLUMN yeasts.diacetyl_production; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.yeasts.diacetyl_production IS 'Relative diacetyl precursor tendency (process still dominates)';


--
-- Name: COLUMN yeasts.analogues; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.yeasts.analogues IS 'Cross-reference product codes (other labs / dry)';


--
-- Name: COLUMN yeasts.usage_count; Type: COMMENT; Schema: api; Owner: postgres
--

COMMENT ON COLUMN api.yeasts.usage_count IS 'Occurrences in completed batches for public library recipes (see calculate_yeast_usage).';


--
-- Name: batches batches_pkey; Type: CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.batches
    ADD CONSTRAINT batches_pkey PRIMARY KEY (id);


--
-- Name: brew_log_comments brew_log_comments_pkey; Type: CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.brew_log_comments
    ADD CONSTRAINT brew_log_comments_pkey PRIMARY KEY (id);


--
-- Name: brew_logs brew_logs_pkey; Type: CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.brew_logs
    ADD CONSTRAINT brew_logs_pkey PRIMARY KEY (id);


--
-- Name: equipment equipment_pkey; Type: CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.equipment
    ADD CONSTRAINT equipment_pkey PRIMARY KEY (user_id);


--
-- Name: grains grains_name_key; Type: CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.grains
    ADD CONSTRAINT grains_name_key UNIQUE (name);


--
-- Name: grains grains_pkey; Type: CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.grains
    ADD CONSTRAINT grains_pkey PRIMARY KEY (id);


--
-- Name: hops hops_name_key; Type: CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.hops
    ADD CONSTRAINT hops_name_key UNIQUE (name);


--
-- Name: hops hops_pkey; Type: CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.hops
    ADD CONSTRAINT hops_pkey PRIMARY KEY (id);


--
-- Name: inventory inventory_pkey; Type: CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.inventory
    ADD CONSTRAINT inventory_pkey PRIMARY KEY (id);


--
-- Name: inventory inventory_user_id_item_type_item_id_key; Type: CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.inventory
    ADD CONSTRAINT inventory_user_id_item_type_item_id_key UNIQUE (user_id, item_type, item_id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: recipes recipes_pkey; Type: CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.recipes
    ADD CONSTRAINT recipes_pkey PRIMARY KEY (id);


--
-- Name: shopping_list_items shopping_list_items_pkey; Type: CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.shopping_list_items
    ADD CONSTRAINT shopping_list_items_pkey PRIMARY KEY (id);


--
-- Name: user_grain_inventory user_grain_inventory_pkey; Type: CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.user_grain_inventory
    ADD CONSTRAINT user_grain_inventory_pkey PRIMARY KEY (user_id, grain_id);


--
-- Name: yeasts yeasts_code_key; Type: CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.yeasts
    ADD CONSTRAINT yeasts_code_key UNIQUE (code);


--
-- Name: yeasts yeasts_pkey; Type: CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.yeasts
    ADD CONSTRAINT yeasts_pkey PRIMARY KEY (id);


--
-- Name: brew_logs_author_id_slug_key; Type: INDEX; Schema: api; Owner: postgres
--

CREATE UNIQUE INDEX brew_logs_author_id_slug_key ON api.brew_logs USING btree (author_id, slug);


--
-- Name: idx_batches_in_progress; Type: INDEX; Schema: api; Owner: postgres
--

CREATE INDEX idx_batches_in_progress ON api.batches USING btree (user_id, status) WHERE (status = ANY (ARRAY['active'::text, 'fermenting'::text]));


--
-- Name: idx_batches_recipe_id; Type: INDEX; Schema: api; Owner: postgres
--

CREATE INDEX idx_batches_recipe_id ON api.batches USING btree (recipe_id);


--
-- Name: idx_batches_user_id; Type: INDEX; Schema: api; Owner: postgres
--

CREATE INDEX idx_batches_user_id ON api.batches USING btree (user_id);


--
-- Name: idx_brew_log_comments_author_id; Type: INDEX; Schema: api; Owner: postgres
--

CREATE INDEX idx_brew_log_comments_author_id ON api.brew_log_comments USING btree (author_id);


--
-- Name: idx_brew_log_comments_log_id; Type: INDEX; Schema: api; Owner: postgres
--

CREATE INDEX idx_brew_log_comments_log_id ON api.brew_log_comments USING btree (log_id);


--
-- Name: idx_brew_logs_author_id; Type: INDEX; Schema: api; Owner: postgres
--

CREATE INDEX idx_brew_logs_author_id ON api.brew_logs USING btree (author_id);


--
-- Name: idx_brew_logs_created_at; Type: INDEX; Schema: api; Owner: postgres
--

CREATE INDEX idx_brew_logs_created_at ON api.brew_logs USING btree (created_at DESC);


--
-- Name: idx_brew_logs_is_official; Type: INDEX; Schema: api; Owner: postgres
--

CREATE INDEX idx_brew_logs_is_official ON api.brew_logs USING btree (is_official) WHERE (is_official = true);


--
-- Name: idx_equipment_user; Type: INDEX; Schema: api; Owner: postgres
--

CREATE INDEX idx_equipment_user ON api.equipment USING btree (user_id);


--
-- Name: idx_recipes_forked_from; Type: INDEX; Schema: api; Owner: postgres
--

CREATE INDEX idx_recipes_forked_from ON api.recipes USING btree (forked_from_id) WHERE (forked_from_id IS NOT NULL);


--
-- Name: idx_recipes_public; Type: INDEX; Schema: api; Owner: postgres
--

CREATE INDEX idx_recipes_public ON api.recipes USING btree (is_private) WHERE (is_private = false);


--
-- Name: idx_recipes_public_style; Type: INDEX; Schema: api; Owner: postgres
--

CREATE INDEX idx_recipes_public_style ON api.recipes USING btree (is_private, style_id) WHERE ((is_private = false) AND (style_id IS NOT NULL));


--
-- Name: idx_recipes_user_id; Type: INDEX; Schema: api; Owner: postgres
--

CREATE INDEX idx_recipes_user_id ON api.recipes USING btree (user_id);


--
-- Name: idx_yeasts_usage_count; Type: INDEX; Schema: api; Owner: postgres
--

CREATE INDEX idx_yeasts_usage_count ON api.yeasts USING btree (usage_count DESC);


--
-- Name: inventory_item_type_idx; Type: INDEX; Schema: api; Owner: postgres
--

CREATE INDEX inventory_item_type_idx ON api.inventory USING btree (user_id, item_type);


--
-- Name: inventory_user_id_idx; Type: INDEX; Schema: api; Owner: postgres
--

CREATE INDEX inventory_user_id_idx ON api.inventory USING btree (user_id);


--
-- Name: profiles_public_code_key; Type: INDEX; Schema: api; Owner: postgres
--

CREATE UNIQUE INDEX profiles_public_code_key ON api.profiles USING btree (public_code);


--
-- Name: shopping_list_items_purchased_idx; Type: INDEX; Schema: api; Owner: postgres
--

CREATE INDEX shopping_list_items_purchased_idx ON api.shopping_list_items USING btree (user_id, is_purchased);


--
-- Name: shopping_list_items_recipe_id_idx; Type: INDEX; Schema: api; Owner: postgres
--

CREATE INDEX shopping_list_items_recipe_id_idx ON api.shopping_list_items USING btree (user_id, recipe_id);


--
-- Name: shopping_list_items_user_id_idx; Type: INDEX; Schema: api; Owner: postgres
--

CREATE INDEX shopping_list_items_user_id_idx ON api.shopping_list_items USING btree (user_id);


--
-- Name: user_grain_inventory_grain_id_idx; Type: INDEX; Schema: api; Owner: postgres
--

CREATE INDEX user_grain_inventory_grain_id_idx ON api.user_grain_inventory USING btree (grain_id);


--
-- Name: batches batches_refresh_yeast_usage; Type: TRIGGER; Schema: api; Owner: postgres
--

CREATE TRIGGER batches_refresh_yeast_usage AFTER INSERT OR UPDATE OF status ON api.batches FOR EACH ROW EXECUTE FUNCTION api.batches_refresh_yeast_usage_on_complete();


--
-- Name: batches batches_set_updated_at; Type: TRIGGER; Schema: api; Owner: postgres
--

CREATE TRIGGER batches_set_updated_at BEFORE UPDATE ON api.batches FOR EACH ROW EXECUTE FUNCTION api.set_updated_at();


--
-- Name: brew_logs brew_logs_set_updated_at; Type: TRIGGER; Schema: api; Owner: postgres
--

CREATE TRIGGER brew_logs_set_updated_at BEFORE UPDATE ON api.brew_logs FOR EACH ROW EXECUTE FUNCTION api.set_updated_at();


--
-- Name: equipment equipment_set_updated_at; Type: TRIGGER; Schema: api; Owner: postgres
--

CREATE TRIGGER equipment_set_updated_at BEFORE UPDATE ON api.equipment FOR EACH ROW EXECUTE FUNCTION api.set_updated_at();


--
-- Name: profiles profiles_ensure_public_code; Type: TRIGGER; Schema: api; Owner: postgres
--

CREATE TRIGGER profiles_ensure_public_code BEFORE INSERT ON api.profiles FOR EACH ROW EXECUTE FUNCTION api.profiles_ensure_public_code();


--
-- Name: profiles profiles_freeze_public_code; Type: TRIGGER; Schema: api; Owner: postgres
--

CREATE TRIGGER profiles_freeze_public_code BEFORE UPDATE ON api.profiles FOR EACH ROW EXECUTE FUNCTION api.profiles_freeze_public_code();


--
-- Name: recipes recipes_set_updated_at; Type: TRIGGER; Schema: api; Owner: postgres
--

CREATE TRIGGER recipes_set_updated_at BEFORE UPDATE ON api.recipes FOR EACH ROW EXECUTE FUNCTION api.set_updated_at();


--
-- Name: batches batches_recipe_id_fkey; Type: FK CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.batches
    ADD CONSTRAINT batches_recipe_id_fkey FOREIGN KEY (recipe_id) REFERENCES api.recipes(id) ON DELETE CASCADE;


--
-- Name: brew_log_comments brew_log_comments_author_id_fkey; Type: FK CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.brew_log_comments
    ADD CONSTRAINT brew_log_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES api.profiles(id) ON DELETE CASCADE;


--
-- Name: brew_log_comments brew_log_comments_log_id_fkey; Type: FK CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.brew_log_comments
    ADD CONSTRAINT brew_log_comments_log_id_fkey FOREIGN KEY (log_id) REFERENCES api.brew_logs(id) ON DELETE CASCADE;


--
-- Name: brew_logs brew_logs_author_id_fkey; Type: FK CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.brew_logs
    ADD CONSTRAINT brew_logs_author_id_fkey FOREIGN KEY (author_id) REFERENCES api.profiles(id) ON DELETE CASCADE;


--
-- Name: equipment equipment_user_id_fkey; Type: FK CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.equipment
    ADD CONSTRAINT equipment_user_id_fkey FOREIGN KEY (user_id) REFERENCES api.profiles(id) ON DELETE CASCADE;


--
-- Name: inventory inventory_user_id_fkey; Type: FK CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.inventory
    ADD CONSTRAINT inventory_user_id_fkey FOREIGN KEY (user_id) REFERENCES api.profiles(id) ON DELETE CASCADE;


--
-- Name: recipes recipes_forked_from_id_fkey; Type: FK CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.recipes
    ADD CONSTRAINT recipes_forked_from_id_fkey FOREIGN KEY (forked_from_id) REFERENCES api.recipes(id) ON DELETE SET NULL;


--
-- Name: shopping_list_items shopping_list_items_recipe_id_fkey; Type: FK CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.shopping_list_items
    ADD CONSTRAINT shopping_list_items_recipe_id_fkey FOREIGN KEY (recipe_id) REFERENCES api.recipes(id) ON DELETE SET NULL;


--
-- Name: shopping_list_items shopping_list_items_user_id_fkey; Type: FK CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.shopping_list_items
    ADD CONSTRAINT shopping_list_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES api.profiles(id) ON DELETE CASCADE;


--
-- Name: user_grain_inventory user_grain_inventory_grain_id_fkey; Type: FK CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.user_grain_inventory
    ADD CONSTRAINT user_grain_inventory_grain_id_fkey FOREIGN KEY (grain_id) REFERENCES api.grains(id) ON DELETE CASCADE;


--
-- Name: user_grain_inventory user_grain_inventory_user_id_fkey; Type: FK CONSTRAINT; Schema: api; Owner: postgres
--

ALTER TABLE ONLY api.user_grain_inventory
    ADD CONSTRAINT user_grain_inventory_user_id_fkey FOREIGN KEY (user_id) REFERENCES api.profiles(id) ON DELETE CASCADE;


--
-- Name: grains Grains readable by everyone; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY "Grains readable by everyone" ON api.grains FOR SELECT USING (true);


--
-- Name: hops Hops are readable by everyone; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY "Hops are readable by everyone" ON api.hops FOR SELECT USING (true);


--
-- Name: user_grain_inventory Users delete own grain inventory; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY "Users delete own grain inventory" ON api.user_grain_inventory FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: inventory Users delete own inventory; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY "Users delete own inventory" ON api.inventory FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: shopping_list_items Users delete own shopping list; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY "Users delete own shopping list" ON api.shopping_list_items FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: user_grain_inventory Users insert own grain inventory; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY "Users insert own grain inventory" ON api.user_grain_inventory FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: inventory Users insert own inventory; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY "Users insert own inventory" ON api.inventory FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: shopping_list_items Users insert own shopping list; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY "Users insert own shopping list" ON api.shopping_list_items FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_grain_inventory Users read own grain inventory; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY "Users read own grain inventory" ON api.user_grain_inventory FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: inventory Users read own inventory; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY "Users read own inventory" ON api.inventory FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: shopping_list_items Users read own shopping list; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY "Users read own shopping list" ON api.shopping_list_items FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: user_grain_inventory Users update own grain inventory; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY "Users update own grain inventory" ON api.user_grain_inventory FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: inventory Users update own inventory; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY "Users update own inventory" ON api.inventory FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: shopping_list_items Users update own shopping list; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY "Users update own shopping list" ON api.shopping_list_items FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: yeasts Yeasts are readable by everyone; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY "Yeasts are readable by everyone" ON api.yeasts FOR SELECT USING (true);


--
-- Name: batches; Type: ROW SECURITY; Schema: api; Owner: postgres
--

ALTER TABLE api.batches ENABLE ROW LEVEL SECURITY;

--
-- Name: brew_log_comments; Type: ROW SECURITY; Schema: api; Owner: postgres
--

ALTER TABLE api.brew_log_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: brew_log_comments brew_log_comments_auth_insert; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY brew_log_comments_auth_insert ON api.brew_log_comments FOR INSERT WITH CHECK ((auth.uid() = author_id));


--
-- Name: brew_log_comments brew_log_comments_owner_delete; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY brew_log_comments_owner_delete ON api.brew_log_comments FOR DELETE USING ((auth.uid() = author_id));


--
-- Name: brew_log_comments brew_log_comments_owner_update; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY brew_log_comments_owner_update ON api.brew_log_comments FOR UPDATE USING ((auth.uid() = author_id)) WITH CHECK ((auth.uid() = author_id));


--
-- Name: brew_log_comments brew_log_comments_public_read; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY brew_log_comments_public_read ON api.brew_log_comments FOR SELECT USING (true);


--
-- Name: brew_logs; Type: ROW SECURITY; Schema: api; Owner: postgres
--

ALTER TABLE api.brew_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: brew_logs brew_logs_auth_insert; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY brew_logs_auth_insert ON api.brew_logs FOR INSERT WITH CHECK ((auth.uid() = author_id));


--
-- Name: brew_logs brew_logs_owner_delete; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY brew_logs_owner_delete ON api.brew_logs FOR DELETE USING ((auth.uid() = author_id));


--
-- Name: brew_logs brew_logs_owner_update; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY brew_logs_owner_update ON api.brew_logs FOR UPDATE USING ((auth.uid() = author_id)) WITH CHECK ((auth.uid() = author_id));


--
-- Name: brew_logs brew_logs_public_read; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY brew_logs_public_read ON api.brew_logs FOR SELECT USING (true);


--
-- Name: equipment; Type: ROW SECURITY; Schema: api; Owner: postgres
--

ALTER TABLE api.equipment ENABLE ROW LEVEL SECURITY;

--
-- Name: equipment equipment_insert_own; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY equipment_insert_own ON api.equipment FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: equipment equipment_select_own; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY equipment_select_own ON api.equipment FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: equipment equipment_update_own; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY equipment_update_own ON api.equipment FOR UPDATE TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: grains; Type: ROW SECURITY; Schema: api; Owner: postgres
--

ALTER TABLE api.grains ENABLE ROW LEVEL SECURITY;

--
-- Name: hops; Type: ROW SECURITY; Schema: api; Owner: postgres
--

ALTER TABLE api.hops ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory; Type: ROW SECURITY; Schema: api; Owner: postgres
--

ALTER TABLE api.inventory ENABLE ROW LEVEL SECURITY;

--
-- Name: batches owner_delete; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY owner_delete ON api.batches FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: recipes owner_delete; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY owner_delete ON api.recipes FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: batches owner_insert; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY owner_insert ON api.batches FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: recipes owner_insert; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY owner_insert ON api.recipes FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: batches owner_read; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY owner_read ON api.batches FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: recipes owner_read; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY owner_read ON api.recipes FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: batches owner_update; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY owner_update ON api.batches FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: recipes owner_update; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY owner_update ON api.recipes FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: profiles; Type: ROW SECURITY; Schema: api; Owner: postgres
--

ALTER TABLE api.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_owner_insert; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY profiles_owner_insert ON api.profiles FOR INSERT TO authenticated WITH CHECK ((auth.uid() = id));


--
-- Name: profiles profiles_owner_update; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY profiles_owner_update ON api.profiles FOR UPDATE USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));


--
-- Name: profiles profiles_public_read; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY profiles_public_read ON api.profiles FOR SELECT USING (true);


--
-- Name: recipes public_read; Type: POLICY; Schema: api; Owner: postgres
--

CREATE POLICY public_read ON api.recipes FOR SELECT USING ((is_private = false));


--
-- Name: recipes; Type: ROW SECURITY; Schema: api; Owner: postgres
--

ALTER TABLE api.recipes ENABLE ROW LEVEL SECURITY;

--
-- Name: shopping_list_items; Type: ROW SECURITY; Schema: api; Owner: postgres
--

ALTER TABLE api.shopping_list_items ENABLE ROW LEVEL SECURITY;

--
-- Name: user_grain_inventory; Type: ROW SECURITY; Schema: api; Owner: postgres
--

ALTER TABLE api.user_grain_inventory ENABLE ROW LEVEL SECURITY;

--
-- Name: yeasts; Type: ROW SECURITY; Schema: api; Owner: postgres
--

ALTER TABLE api.yeasts ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA api; Type: ACL; Schema: -; Owner: postgres
--

GRANT USAGE ON SCHEMA api TO anon;
GRANT USAGE ON SCHEMA api TO authenticated;


--
-- Name: SCHEMA auth; Type: ACL; Schema: -; Owner: postgres
--

GRANT USAGE ON SCHEMA auth TO anon;
GRANT USAGE ON SCHEMA auth TO authenticated;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;


--
-- Name: FUNCTION batches_refresh_yeast_usage_on_complete(); Type: ACL; Schema: api; Owner: postgres
--

GRANT ALL ON FUNCTION api.batches_refresh_yeast_usage_on_complete() TO anon;
GRANT ALL ON FUNCTION api.batches_refresh_yeast_usage_on_complete() TO authenticated;


--
-- Name: FUNCTION calculate_yeast_usage(); Type: ACL; Schema: api; Owner: postgres
--

GRANT ALL ON FUNCTION api.calculate_yeast_usage() TO anon;
GRANT ALL ON FUNCTION api.calculate_yeast_usage() TO authenticated;


--
-- Name: FUNCTION ensure_user_profile(); Type: ACL; Schema: api; Owner: postgres
--

REVOKE ALL ON FUNCTION api.ensure_user_profile() FROM PUBLIC;
GRANT ALL ON FUNCTION api.ensure_user_profile() TO authenticated;


--
-- Name: FUNCTION generate_unique_public_code(); Type: ACL; Schema: api; Owner: postgres
--

GRANT ALL ON FUNCTION api.generate_unique_public_code() TO anon;
GRANT ALL ON FUNCTION api.generate_unique_public_code() TO authenticated;


--
-- Name: FUNCTION profile_username_is_taken(p_candidate text, p_user_id text); Type: ACL; Schema: api; Owner: postgres
--

GRANT ALL ON FUNCTION api.profile_username_is_taken(p_candidate text, p_user_id text) TO anon;
GRANT ALL ON FUNCTION api.profile_username_is_taken(p_candidate text, p_user_id text) TO authenticated;


--
-- Name: FUNCTION profiles_ensure_public_code(); Type: ACL; Schema: api; Owner: postgres
--

GRANT ALL ON FUNCTION api.profiles_ensure_public_code() TO anon;
GRANT ALL ON FUNCTION api.profiles_ensure_public_code() TO authenticated;


--
-- Name: FUNCTION profiles_freeze_public_code(); Type: ACL; Schema: api; Owner: postgres
--

GRANT ALL ON FUNCTION api.profiles_freeze_public_code() TO anon;
GRANT ALL ON FUNCTION api.profiles_freeze_public_code() TO authenticated;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: api; Owner: postgres
--

GRANT ALL ON FUNCTION api.set_updated_at() TO anon;
GRANT ALL ON FUNCTION api.set_updated_at() TO authenticated;


--
-- Name: TABLE batches; Type: ACL; Schema: api; Owner: postgres
--

GRANT ALL ON TABLE api.batches TO anon;
GRANT ALL ON TABLE api.batches TO authenticated;


--
-- Name: TABLE brew_log_comments; Type: ACL; Schema: api; Owner: postgres
--

GRANT ALL ON TABLE api.brew_log_comments TO anon;
GRANT ALL ON TABLE api.brew_log_comments TO authenticated;


--
-- Name: TABLE brew_logs; Type: ACL; Schema: api; Owner: postgres
--

GRANT ALL ON TABLE api.brew_logs TO anon;
GRANT ALL ON TABLE api.brew_logs TO authenticated;


--
-- Name: TABLE equipment; Type: ACL; Schema: api; Owner: postgres
--

GRANT ALL ON TABLE api.equipment TO anon;
GRANT ALL ON TABLE api.equipment TO authenticated;


--
-- Name: TABLE grains; Type: ACL; Schema: api; Owner: postgres
--

GRANT ALL ON TABLE api.grains TO anon;
GRANT ALL ON TABLE api.grains TO authenticated;


--
-- Name: TABLE hops; Type: ACL; Schema: api; Owner: postgres
--

GRANT ALL ON TABLE api.hops TO anon;
GRANT ALL ON TABLE api.hops TO authenticated;


--
-- Name: TABLE inventory; Type: ACL; Schema: api; Owner: postgres
--

GRANT ALL ON TABLE api.inventory TO anon;
GRANT ALL ON TABLE api.inventory TO authenticated;


--
-- Name: TABLE profiles; Type: ACL; Schema: api; Owner: postgres
--

GRANT ALL ON TABLE api.profiles TO anon;
GRANT ALL ON TABLE api.profiles TO authenticated;


--
-- Name: TABLE recipes; Type: ACL; Schema: api; Owner: postgres
--

GRANT ALL ON TABLE api.recipes TO anon;
GRANT ALL ON TABLE api.recipes TO authenticated;


--
-- Name: TABLE shopping_list_items; Type: ACL; Schema: api; Owner: postgres
--

GRANT ALL ON TABLE api.shopping_list_items TO anon;
GRANT ALL ON TABLE api.shopping_list_items TO authenticated;


--
-- Name: TABLE user_grain_inventory; Type: ACL; Schema: api; Owner: postgres
--

GRANT ALL ON TABLE api.user_grain_inventory TO anon;
GRANT ALL ON TABLE api.user_grain_inventory TO authenticated;


--
-- Name: TABLE yeasts; Type: ACL; Schema: api; Owner: postgres
--

GRANT ALL ON TABLE api.yeasts TO anon;
GRANT ALL ON TABLE api.yeasts TO authenticated;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: api; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA api GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA api GRANT ALL ON SEQUENCES TO authenticated;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: api; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA api GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA api GRANT ALL ON TABLES TO authenticated;


--
-- PostgreSQL database dump complete
--

