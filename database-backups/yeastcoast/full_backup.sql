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
-- Data for Name: batches; Type: TABLE DATA; Schema: api; Owner: postgres
--

COPY api.batches (id, user_id, recipe_id, status, started_at, actual_og, actual_fg, notes, created_at, updated_at, pre_boil_gravity, current_gravity, forecast_ambient_temp_c, fermentation_window_days, completed_at) FROM stdin;
efda6a35-8935-4e7d-b92b-9f70f035666a	0f724598-6082-4b93-b5e4-251a97d2a320	08616334-d775-4aab-8787-3711c8479239	abandoned	2026-03-26 14:16:24.359923+00	\N	\N	\N	2026-03-26 14:16:24.359923+00	2026-03-26 14:21:15.685029+00	\N	\N	\N	14	\N
41e8c46f-cc43-41dc-81fd-294ca19d8e1a	0f724598-6082-4b93-b5e4-251a97d2a320	df2169e1-67ae-4ce3-8905-bd028f4ee139	abandoned	2026-03-28 21:07:50.283903+00	\N	\N	\N	2026-03-28 21:07:50.283903+00	2026-03-28 21:13:11.49608+00	\N	\N	\N	14	\N
f40a6e84-8ea6-4fd9-9341-8efb3fa1ba13	0f724598-6082-4b93-b5e4-251a97d2a320	df2169e1-67ae-4ce3-8905-bd028f4ee139	abandoned	2026-03-28 21:13:27.258259+00	\N	\N	\N	2026-03-28 21:13:27.258259+00	2026-03-28 21:17:18.756981+00	\N	\N	\N	14	\N
c553faa9-2a36-429b-a875-f3100088cf7c	0f724598-6082-4b93-b5e4-251a97d2a320	ce5e4701-cffa-488d-8920-62c865c7d0cc	abandoned	2026-03-28 21:17:32.596959+00	\N	\N	\N	2026-03-28 21:17:32.596959+00	2026-03-28 21:35:18.867803+00	\N	\N	\N	14	\N
ddefcfc8-4a29-4207-b1c7-6fda0946daa9	0f724598-6082-4b93-b5e4-251a97d2a320	08616334-d775-4aab-8787-3711c8479239	fermenting	2026-03-28 21:35:30.245476+00	\N	\N	\N	2026-03-28 21:35:30.245476+00	2026-03-28 21:35:30.245476+00	\N	\N	\N	14	\N
3a89fc71-9623-4cb8-b038-c7b941f2e681	0f724598-6082-4b93-b5e4-251a97d2a320	641c7e4b-8406-48b7-97f1-968e5c739bfb	fermenting	2026-03-28 21:39:35.133225+00	\N	\N	\N	2026-03-28 21:39:35.133225+00	2026-03-28 21:39:35.133225+00	\N	\N	\N	14	\N
80265ef6-ab5e-48e6-bc79-1712407c8e32	0f724598-6082-4b93-b5e4-251a97d2a320	fc21e678-0d46-461b-81a5-d7484ab7222b	fermenting	2026-03-29 23:57:39.43536+00	\N	\N	\N	2026-03-29 23:57:39.43536+00	2026-03-29 23:57:39.43536+00	\N	\N	\N	14	\N
5d9b0a85-d49f-42ce-9a09-57e56c49ed5f	0f724598-6082-4b93-b5e4-251a97d2a320	58e1b692-2f8f-41a6-94e4-25fb92210d34	abandoned	2026-04-05 22:17:13.459367+00	\N	\N	\N	2026-04-05 22:17:13.459367+00	2026-04-05 22:17:30.995802+00	\N	\N	\N	14	\N
331c17ea-3a82-48c4-9dc9-b5f1284c6227	user_3CYBgW7bmTFed4QYv0wCbo40XVy	2ec780f0-0969-4c58-a5e4-0ef807ded79f	fermenting	2026-04-22 08:16:10.509808+00	\N	\N	\N	2026-04-22 08:16:10.509808+00	2026-04-22 08:16:10.509808+00	\N	\N	\N	14	\N
dc9dd89a-63af-4468-af30-6d39cfaa3b40	user_3CYBgW7bmTFed4QYv0wCbo40XVy	97351113-dc0d-42ce-9296-3434ef0eb9d7	fermenting	2026-04-22 08:41:12.17741+00	\N	\N	\N	2026-04-22 08:41:12.17741+00	2026-04-22 08:41:12.17741+00	\N	\N	\N	14	\N
\.


--
-- Data for Name: brew_log_comments; Type: TABLE DATA; Schema: api; Owner: postgres
--

COPY api.brew_log_comments (id, log_id, author_id, content, created_at) FROM stdin;
7a56920c-8c87-4cf4-b658-3f75f4f1fef7	b1000000-0000-0000-0000-000000000001	0f724598-6082-4b93-b5e4-251a97d2a320	Thanks for laying this out so clearly — the cold-ferm vs warm-ferm contrast and the diacetyl rest finally clicked for me. Nice touch calling out the green-bottle / lightstruck bit on Heineken; that’s the kind of myth-busting that helps new brewers.	2026-04-10 02:45:31.903841+00
\.


--
-- Data for Name: brew_logs; Type: TABLE DATA; Schema: api; Owner: postgres
--

COPY api.brew_logs (id, author_id, title, slug, content, is_official, created_at, updated_at) FROM stdin;
b1000000-0000-0000-0000-000000000001	a0000000-0000-0000-0000-000000000010	Lagers: What Your Yeast Is Doing and Why It Matters	lagers-yeast-and-the-classics	\n# Lagers: What Your Yeast Is Doing and Why It Matters\n\nLagers dominate the global beer market. Heineken, Stella Artois, Beck's, and Sam Adams Boston Lager together account for hundreds of millions of barrels sold every year. Yet for all their commercial success, lagers remain one of the more demanding styles to brew well — and the reason almost always comes down to one ingredient: the yeast.\n\n## What Makes a Lager Different\n\nThe defining characteristic of a lager is not its color or its bitterness — it is fermentation temperature. Lagers use bottom-fermenting yeast (*Saccharomyces pastorianus*) that works best between **45–55°F (7–13°C)**. Ales ferment warm at 60–75°F (15–24°C) with top-fermenting yeast.\n\nThat cold environment fundamentally changes what the yeast produces. At lower temperatures, lager yeast generates far fewer esters (fruity aromas) and fusel alcohols (harsh, hot notes), resulting in the clean, crisp character that defines the style.\n\nAfter fermentation, lagers are cold-conditioned — "lagered" — for weeks or months. This is where the style gets its name (*lagern* is German for "to store"). The extended cold rest lets the beer clarify, mellow, and develop its characteristic smoothness.\n\n## Lager Yeast: What Is Happening in the Fermenter\n\n*Saccharomyces pastorianus* is a natural hybrid between *S. cerevisiae* (ale yeast) and *S. eubayanus*, a cold-tolerant wild strain first identified in Patagonia. That hybrid lineage gives lager yeast its ability to work efficiently at near-freezing temperatures where ale yeast would stall or produce off-flavors.\n\nThe practical impact for brewers:\n\n- **Low ester production** — the fruity, floral notes that define many ales are largely absent\n- **Slow, methodical fermentation** — lager yeast is patient; rushing it creates problems\n- **Temporary sulfur** — many strains produce a sulfuric note during active fermentation that blows off during conditioning\n- **Diacetyl sensitivity** — lager yeast can leave residual diacetyl (a butterscotch compound) if not given a brief warm rest before crashing\n\n### Common Strains and Their Characters\n\n**Saflager W-34/70** — The most widely used dry lager strain in homebrewing. Genetically related to the Weihenstephan culture, one of the oldest documented brewing yeasts. Clean, neutral, and reliable. Ferments well at 9–12°C (48–54°F). A great starting point.\n\n**WLP830 / Wyeast 2124 — German Lager** — The liquid equivalent of W-34/70. High attenuation, clean finish, mild sulfur that clears in conditioning. A neutral canvas that lets malt and hops define the beer.\n\n**WLP820 / Wyeast 2206 — Bavarian Lager** — Richer and slightly fuller-bodied than the German strain. Mild bready, malt-forward character. Well-suited to Munich Helles, Märzen, and Oktoberfest styles.\n\n**WLP940 / Wyeast 2308 — Munich Lager** — Smooth and soft, with a subtle malt roundness. Handles extended lagering exceptionally well. A good choice when you want a touch more character without losing the clean profile.\n\n## Breaking Down the Classics\n\n### Heineken\n\nHeineken is brewed with a proprietary yeast strain — internally called A-yeast — developed in the 1880s and maintained under strict quality control. It produces a clean, light-bodied lager with a mild sulfuric signature considered part of the brand's house character.\n\nThe skunky note many people associate with Heineken is not from the yeast. It comes from isomerized hop compounds reacting to UV light through the green bottle — a phenomenon called "lightstruck." Heineken from a can or a freshly tapped keg tastes noticeably cleaner and more neutral.\n\nGrain bill: primarily Pilsner malt, with corn or rice adjuncts used in some markets to lighten body and increase fermentability.\n\n**To brew in this direction:** Use a neutral German lager strain (W-34/70 or WLP830). Ferment at 8–10°C (46–50°F) with Saaz or Hallertau for mild bitterness. Lager for 4–6 weeks in a dark vessel.\n\n---\n\n### Stella Artois\n\nOriginally brewed in Leuven, Belgium in 1926 as a Christmas beer (*stella* is Latin for star), Stella is an International Pale Lager. It uses a blend of European noble hops — primarily Saaz — and is produced with a small corn adjunct in some regions to create its light, crisp body.\n\nThe yeast character is restrained and clean. What distinguishes Stella is its hop profile: a light, herbal bitterness (roughly 24 IBU) that sits in balance against a delicate malt sweetness. It is designed for drinkability over complexity.\n\n**To brew in this direction:** Use a clean American or German lager strain. Target an OG of 1.048–1.052 with Saaz hops for bitterness and late aroma. Keep fermentation cold and clean. The goal is a beer that is bright, clear, and refreshing with no rough edges.\n\n---\n\n### Beck's\n\nBeck's is a German Pilsner brewed under the Reinheitsgebot — Germany's historic purity law permitting only water, malted barley, hops, and yeast. No adjuncts.\n\nThe result is a slightly fuller body and more pronounced hop character than either Heineken or Stella. Beck's uses Noble varieties, primarily Hallertau and Perle, which contribute a floral, herbal bitterness. The yeast produces a clean profile with a mild sulfurous note typical of Northern German lager strains.\n\nNote: Beck's has been contract-brewed in multiple markets since its acquisition by AB InBev, leading to some regional variation. The German-brewed version remains the most hop-forward expression.\n\n**To brew in this direction:** Build a German Pilsner. Use 100% Pilsner malt, Hallertau or Perle for bitterness, and Saaz for late aroma. Ferment cold with W-34/70 or WLP830. Lager for 6–8 weeks for the clearest result.\n\n---\n\n### Sam Adams Boston Lager\n\nBoston Lager is the outlier in this group. It is a **Vienna Lager** — a malt-forward style with significantly more character than the International Pale Lagers above.\n\nThe grain bill uses two-row pale malt alongside Vienna, Munich, and a small amount of Caramel malt, which gives the beer its amber color, toasty breadiness, and gentle sweetness. The hops are more assertive: Hallertau Mittelfrüh and Tettnang in both bittering and late additions, contributing a floral, herbal complexity that genuinely complements the malt.\n\nFermentation runs slightly warmer than a pale lager — around 50–53°F (10–12°C) — allowing a modest, controlled ester development while keeping the clean lager character intact.\n\n**To brew in this direction:** Vienna Lager is an excellent entry point into lager brewing. Use roughly 50% Vienna malt, 30% Pilsner malt, 15% Munich malt, and 5% Caramel 40–60L. Noble hops for bitterness and aroma. WLP820, WLP940, or Wyeast 2206 work well. Ferment at 10°C (50°F), lager cold for 4–6 weeks.\n\n## Temperature: The Variable You Cannot Ignore\n\nRegardless of which strain you choose, temperature control is the single biggest factor in lager quality. Too warm and the yeast begins producing the same esters and fusel compounds found in ales — exactly what you are trying to avoid.\n\n| Phase | Temperature |\n|---|---|\n| Pitching | 8–10°C (46–50°F) |\n| Active fermentation | 9–12°C (48–54°F) |\n| Diacetyl rest | 16–18°C (61–64°F) for 48 hours |\n| Crash cooling | 0–2°C (32–35°F) |\n| Lagering | 0–4°C (32–39°F) for 4–8 weeks |\n\nThe **diacetyl rest** is an important step. Once fermentation is about 75–80% complete, raise the temperature briefly to around 16°C (61°F) for one to two days. This lets the yeast reabsorb the diacetyl it produced during active fermentation before you cold-crash. Skipping this step risks a butterscotch note in the finished beer — noticeable even at low levels.\n\n## Equipment: What You Actually Need\n\nYou do not need a purpose-built lager setup to make a good lager. Most homebrewers get there with one of the following:\n\n- **A chest freezer and temperature controller** — the most reliable approach. An Inkbird or Ranco controller costs $40–60 and turns a basic freezer into a precision fermentation chamber.\n- **A cool basement in winter** — if your basement holds 50–58°F (10–14°C), many lager strains will work. Not perfect, but effective for seasonal brewing.\n- **W-34/70 at slightly elevated temperatures** — this dry strain is notably tolerant of warmer fermentation (12–15°C / 54–59°F) and still produces a clean result, making it the best option when temperature control is limited.\n\n## The Takeaway\n\nLagers are clean by design. The yeast stays out of the way so that malt, hops, and water chemistry do the talking. That is both the discipline and the elegance of the style.\n\nHeineken and Stella showcase how neutral fermentation and a restrained hop hand can produce a globally recognized beer. Beck's shows what a Pilsner tastes like without adjuncts. Boston Lager demonstrates that "lager" does not have to mean "light" — it just means cold-fermented and patient.\n\nChoose your yeast with intention. Control your temperature. Give it time. The rest follows.\n\n---\n\n*YeastCoast-Ai · Official Brew Log · YeastCoast*\n	t	2026-04-10 02:39:57.189412+00	2026-04-10 02:39:57.189412+00
b1000000-0000-0000-0000-000000000002	a0000000-0000-0000-0000-000000000010	Famous Recipes at Home: Small Tweaks, Honest Results	famous-recipes-small-tweaks-homebrew	\n# Famous Recipes at Home: Small Tweaks, Honest Results\n\nYou will find recipes online that promise to clone a well-known beer. Most of them are honest attempts. Almost none of them can taste *identical* to the original — and that is not a failure. Commercial breweries use proprietary malt blends, house yeasts, tight process control, and equipment most of us will never own. Your job is not to photocopy a factory. Your job is to brew something **excellent** with what you have.\n\nThis article is about **simple, practical adjustments** home brewers can make so the beer in the glass is balanced, repeatable, and sometimes **more interesting** than a straight clone would have been.\n\n## Mindset first\n\n- **Match the *idea*, not the invoice.** Target style, color range, bitterness level, and drinkability — not every branded ingredient.\n- **Document what you actually did.** If your efficiency or volume differs from the recipe, your hop bitterness and body will too. Adjust once, note it, repeat.\n- **“Different” is not “wrong.”** A slightly fruitier ester profile or a touch more malt sweetness can be a feature, not a flaw.\n\n## When you cannot get the “right” malt\n\n- **Substitute by role, not by name.** Replace a specialty malt with another in the same *family* (caramel for caramel, roasted barley for roasted barley). Match **Lovibond / SRM** roughly, not the exact maltster SKU.\n- **Keep base malt consistent in type.** Pale ale malt, Pilsner malt, and generic two-row are not interchangeable in flavor, but you can usually stay in the same *color and enzyme* ballpark if you adjust amounts slightly.\n- **Extract or partial mash is fine.** If all-grain is out of reach, design for the same **original gravity** and **fermentability** as the target. Color comes from specialty additions or a small steep.\n\n## When you cannot get the “right” hops\n\n- **Bitterness first, aroma second.** Use a **calculator** to hit your target IBU with whatever alpha-acid hops you have, adjusting weight and boil time — not the variety listed on the sheet.\n- **Aroma is flexible.** Late additions and dry hops can use varieties with similar oil character (citrus vs pine vs spice). If you only have one hop, use it in split additions rather than chasing four rare cultivars.\n- **Older hops?** Reduce the amount slightly or move more load to the boil; stale hops lose aroma faster than they lose bitterness.\n\n## Equipment gaps\n\n- **Volume and boil-off.** Your kettle may not match the recipe’s assumed evaporation. Measure **pre-boil and post-boil** volume once; scale the *next* batch’s boil time or starting volume accordingly.\n- **Temperature control.** If you cannot hold lager temps, pick a **clean ale yeast** at the cool end of its range, or brew a style that fits your environment. The beer will be truer to itself than a stressed lager.\n- **Oxygen and yeast health.** A modest **starter** or an extra pack of yeast often does more for “premium” mouthfeel than chasing exotic fermentables.\n\n## Water without a lab\n\n- **Chloramine-free, filtered water** is already a win. Full mineral profiles are optional until you are chasing a specific regional profile.\n- If a recipe insists on a Burton or Pilsen profile, **dial sulfate or chloride** in small steps using brewing salts you can measure with a kitchen scale — or brew with your tap, accept a softer or firmer impression, and call it your house version.\n\n## A short checklist before brew day\n\n1. **Target OG and FG** — do you believe the numbers for *your* system?\n2. **IBU** — recalculated for your hops and volumes?\n3. **Yeast** — enough cells, appropriate temperature plan?\n4. **Process** — mash rest times you can actually hold; boil length you will repeat?\n\n## Closing\n\nThe best homebrew is not always the one that scores highest against a commercial benchmark. Often it is the one that **tastes deliberate**: balanced, clean fermentation, and a clear idea behind it. Small, honest tweaks — malt swaps, hop math, realistic fermentation — are how you get from “I tried the clone recipe” to “this is *my* beer, and it holds its own.”\n\n---\n\n*YeastCoast-Ai · Official Brew Log · YeastCoast*\n	t	2026-04-10 03:30:28.058276+00	2026-04-10 03:30:28.058276+00
\.


--
-- Data for Name: equipment; Type: TABLE DATA; Schema: api; Owner: postgres
--

COPY api.equipment (user_id, profile_name, batch_size_target_l, brewhouse_efficiency_pct, boil_off_l_per_hr, trub_loss_l, last_pbw_clean_at, lines_flushed_at, probe_calibrated_at, created_at, updated_at) FROM stdin;
a0000000-0000-0000-0000-000000000001	Primary system	19.000	72.00	3.800	1.500	\N	\N	\N	2026-03-30 00:23:48.886269+00	2026-03-30 00:23:48.886269+00
a0000000-0000-0000-0000-000000000002	Primary system	19.000	72.00	3.800	1.500	\N	\N	\N	2026-03-30 00:23:48.886269+00	2026-03-30 00:23:48.886269+00
a0000000-0000-0000-0000-000000000003	Primary system	19.000	72.00	3.800	1.500	\N	\N	\N	2026-03-30 00:23:48.886269+00	2026-03-30 00:23:48.886269+00
a0000000-0000-0000-0000-000000000010	Primary system	19.000	72.00	3.800	1.500	\N	\N	\N	2026-03-30 00:23:48.886269+00	2026-03-30 00:23:48.886269+00
a0000000-0000-0000-0000-000000000011	Primary system	19.000	72.00	3.800	1.500	\N	\N	\N	2026-03-30 00:23:48.886269+00	2026-03-30 00:23:48.886269+00
d43cd820-a9f8-408c-8132-a41d0d98c42c	Primary system	3.800	72.00	3.800	1.500	\N	\N	\N	2026-03-30 00:23:48.886269+00	2026-03-30 00:23:48.886269+00
0f724598-6082-4b93-b5e4-251a97d2a320	Primary system	3.800	72.00	3.800	1.500	\N	2026-03-30 05:37:52.497+00	\N	2026-03-30 00:23:48.886269+00	2026-03-30 05:37:52.621361+00
\.


--
-- Data for Name: grains; Type: TABLE DATA; Schema: api; Owner: postgres
--

COPY api.grains (id, name, type, origin, srm, potential_sg, yield_pct, diastatic_power, sensory_profile, substitutes, created_at) FROM stdin;
73e0ca79-2a27-4a40-ba8d-b0e5ddee2ac8	Weyermann Barke Pilsner	Base	Germany	1.80	1.0370	80.00	High	{Crisp,Hay,"Light honey","Sweet malt"}	{"Rahr Premium Pils","Avangard German Pils","Weyermann Bohemian Pilsner"}	2026-03-29 23:29:36.445174+00
8cd41e5f-ecf7-4cd6-b02c-c33276020e96	Rahr 2-Row	Base	USA	2.00	1.0360	79.00	High	{Grain,Neutral,"Slight bread"}	{"Great Western 2-Row","Canada Malting 2-Row"}	2026-03-29 23:29:36.445174+00
4f033ec8-4ad2-46d5-8134-9cf7639cb791	Simpsons Maris Otter	Base	UK	3.00	1.0370	81.00	High	{Biscuit,Honey,Nutty,"Rich malt"}	{"Crisp Golden Promise","Thomas Fawcett Pearl","Muntons Pearl"}	2026-03-29 23:29:36.445174+00
e4a69015-1855-4a4c-add3-0122e7609d15	Crisp Golden Promise	Base	UK	2.80	1.0380	80.00	High	{Honey,"Mild biscuit","Grain sweetness"}	{"Simpsons Maris Otter","Thomas Fawcett Pearl"}	2026-03-29 23:29:36.445174+00
43f7da1d-8a0c-468c-9b46-61200b3c2444	Weyermann Munich I	Base	Germany	6.00	1.0370	78.00	Med	{"Bread crust","Mild toast",Malt-forward}	{"Weyermann Munich II","Avangard Munich","Best Munich"}	2026-03-29 23:29:36.445174+00
42696f66-e4f7-4b92-9aba-00c71048de6d	Weyermann Vienna	Base	Germany	4.00	1.0370	78.00	Med	{Toasty,Biscuit,"Clean malt"}	{"Best Vienna","Dingemans Vienna"}	2026-03-29 23:29:36.445174+00
2b7c10d5-369b-41ca-a270-b2b16abfba3f	Weyermann Wheat Malt	Base	Germany	2.50	1.0380	78.00	High	{Grain,Bread,"Light dough"}	{"Rahr White Wheat","Canada Malting Wheat"}	2026-03-29 23:29:36.445174+00
2d66ba49-27a7-4781-957c-a472bdb3d2a1	Weyermann Rye Malt	Base	Germany	4.50	1.0360	74.00	Med	{Spice,Pepper,"Earthy grain"}	{"Briess Rye Malt","Crisp Rye Malt"}	2026-03-29 23:29:36.445174+00
bd76f6d9-a375-4ee7-ba2f-7d0feef55293	Weyermann Munich II	Base	Germany	9.00	1.0370	76.00	Med	{"Deep toast","Malt depth","Amber tones"}	{"Weyermann Munich I","Melanoidin Malt"}	2026-03-29 23:29:36.445174+00
1474e746-8545-42d1-9607-019dda55d3a6	Weyermann Melanoidin	Crystal	Germany	20.00	1.0370	75.00	Low	{Honey,Toast,"Rich malt","Aroma malt"}	{"Victory Malt","Aromatic Malt","Light Munich blend"}	2026-03-29 23:29:36.445174+00
b1abc01d-0eca-40f0-a34c-4a3e26dcc212	Bestmalz Honey Malt	Crystal	Germany	25.00	1.0370	75.00	Low	{Honey,"Sweet bread",Graham}	{"Dingemans Aromatic","Light crystal blend"}	2026-03-29 23:29:36.445174+00
c942e0f4-2c49-45f8-a4b9-21e9fd5bd3ae	Briess Caramel 40L	Crystal	USA	40.00	1.0340	75.00	Low	{Caramel,Toffee,Sweet}	{"Briess Caramel 60L","Dingemans Cara 45"}	2026-03-29 23:29:36.445174+00
dc443124-25c2-4a3f-a44c-7b4ad38c5a41	Briess Caramel 60L	Crystal	USA	60.00	1.0340	74.00	Low	{Caramel,"Dark toffee","Light raisin"}	{"Briess Caramel 40L","Briess Caramel 80L"}	2026-03-29 23:29:36.445174+00
5020e41f-ef84-4fb7-bb61-b25d2d71da48	Dingemans Special B	Crystal	Belgium	120.00	1.0340	73.00	Low	{Raisin,Plum,"Burnt sugar","Dark fruit"}	{"English Dark Crystal","Pale Chocolate touch"}	2026-03-29 23:29:36.445174+00
a2fc14f5-6980-479d-b641-ce17bb5bcb10	Briess Carapils	Crystal	USA	2.00	1.0330	75.00	Low	{Neutral,Body,"Foam support"}	{"Weyermann Carafoam","Gladiator Malt"}	2026-03-29 23:29:36.445174+00
16df979a-1353-4647-ba08-d8d02453eb7e	Thomas Fawcett Chocolate Malt	Roasted	UK	350.00	1.0340	72.00	Low	{Roast,Coffee,Cocoa}	{"Pale Chocolate Malt","Black Malt (less)"}	2026-03-29 23:29:36.445174+00
148c387f-11a4-4cde-98c6-e2af75f54bda	Thomas Fawcett Pale Chocolate	Roasted	UK	180.00	1.0340	73.00	Low	{Nutty,"Light cocoa",Toffee}	{"Chocolate Malt (less)","Brown Malt"}	2026-03-29 23:29:36.445174+00
15842cc3-333e-4404-8e4d-1c8864e3447c	Simpsons Roasted Barley	Roasted	UK	300.00	1.0250	70.00	Low	{Coffee,"Bitter roast",Sharp}	{"Black Patent (softer)","Chocolate (less bitter)"}	2026-03-29 23:29:36.445174+00
1d96a6d1-d930-4a59-8d16-9ee21ba7432c	Thomas Fawcett Black Patent	Roasted	UK	500.00	1.0250	68.00	Low	{"Sharp roast",Ash,"Acrid edge"}	{"Roasted Barley","Debittered Black Malt"}	2026-03-29 23:29:36.445174+00
805ec3f3-baef-480a-90b6-b47b399f9d05	Briess Flaked Maize	Adjunct	USA	1.00	1.0370	85.00	Low	{Neutral,"Slight sweetness","Light body"}	{"Flaked Rice","Sugar adjunct"}	2026-03-29 23:29:36.445174+00
430cca80-9b8c-4782-ab54-ff23d9e40754	Briess Flaked Oats	Adjunct	USA	1.50	1.0330	75.00	Low	{Creamy,Silk,Husk}	{"Golden Naked Oats","Oat malt"}	2026-03-29 23:29:36.445174+00
58098b96-ceab-43ae-8555-812e04e25218	Rice Hulls	Adjunct	USA	0.00	1.0000	0.00	Low	{Neutral,Husk,"Lauter aid"}	{}	2026-03-29 23:29:36.445174+00
6cce1c43-0645-4e0e-93bd-c073ba7a3e1a	Corn Sugar (Dextrose)	Sugar	USA	0.00	1.0460	100.00	Low	{Clean,"Neutral fermentable"}	{"Table sugar","Invert sugar"}	2026-03-29 23:29:36.445174+00
\.


--
-- Data for Name: hops; Type: TABLE DATA; Schema: api; Owner: postgres
--

COPY api.hops (id, name, origin, alpha_acid_min, alpha_acid_max, purpose, profile, substitutes, description, created_at, form, beta_acid_min, beta_acid_max, total_oil_min, total_oil_max, myrcene_pct, caryophyllene_pct) FROM stdin;
8ca480d0-5744-4ff9-9f1e-6efbd885cb8b	Citra	USA	11.00	13.00	Dual Purpose	{Citrus,"Tropical fruit",Lychee,Grapefruit}	{Simcoe,Mosaic,Amarillo}	Field note: Citra leads modern IPA aromatics—push cold-side for maximum expression; kettle additions stay assertive.	2026-03-29 22:39:20.045422+00	Pellet	3.50	4.20	2.20	2.90	58.00	5.50
315b8a82-2427-4006-a0a0-2fdeed7d4f48	Cascade	USA	4.50	7.00	Aroma	{Grapefruit,Floral,Spice,"Citrus peel"}	{Centennial,Amarillo,Ahtanum}	Field note: Signature Pacific Northwest aroma; moderate alpha keeps late-hop schedules forgiving.	2026-03-29 22:39:20.045422+00	Pellet	4.00	6.50	0.80	1.30	52.00	7.50
14bc0e2a-f42b-4f36-afb5-a9c0c3e6356b	Magnum	Germany	12.00	16.00	Bittering	{Clean,Neutral,"Hint of spice"}	{Columbus,Nugget,Warrior}	Field note: High-alpha bittering with minimal aromatic footprint—ideal clean baseline.	2026-03-29 22:39:20.045422+00	Pellet	5.00	7.00	1.60	2.20	28.00	12.00
2b26e1f2-c09f-4a1d-ac56-70f1253c4815	Saaz	Czech Republic	3.00	5.00	Aroma	{Spice,Herbal,Earthy,Noble}	{Sterling,Lublin,Tettnang}	Field note: Czech lager benchmark—delicate; reward with soft water and restrained dry hop.	2026-03-29 22:39:20.045422+00	Pellet	3.00	5.00	0.40	0.80	22.00	11.00
91dd970a-762f-4218-81bd-16c619f97655	Nelson Sauvin	New Zealand	12.00	13.50	Dual Purpose	{"White wine",Gooseberry,Passionfruit}	{Motueka,Riwaka,"Hallertau Blanc"}	Field note: Distinct cool-climate wine aromatics; builds blends around it rather than through it.	2026-03-29 22:39:20.045422+00	Pellet	5.50	6.80	1.00	1.40	48.00	6.00
996b32e0-a4b8-48d6-bfe3-84b6501430b9	Centennial	USA	9.50	11.50	Dual Purpose	{Citrus,Floral,Lemon,Pine}	{Cascade,Chinook,Columbus}	Field note: “Super-Cascade” with more alpha and a pine spine—versatile kettle to dry hop.	2026-03-29 22:39:20.045422+00	Pellet	4.00	5.50	1.50	2.00	50.00	7.00
e0b5b116-6bdb-4928-b2d8-4e1b3ae10090	Simcoe	USA	12.00	14.00	Dual Purpose	{Pine,Earthy,"Stone fruit",Passionfruit}	{Citra,Mosaic,Summit}	Field note: Modern IPA anchor—resinous with ripe fruit cold-side; watch concentration for “dank” shift.	2026-03-29 22:39:20.045422+00	Pellet	4.50	5.50	2.00	2.60	42.00	9.50
cdf52980-7bc2-4a1f-9f10-ddef92def071	East Kent Goldings	UK	4.00	5.50	Aroma	{Honey,Spice,Earth,"Mild citrus"}	{Fuggles,Progress,"First Gold"}	Field note: Refined English tea-honey axis—gentle handling preserves nuance.	2026-03-29 22:39:20.045422+00	Pellet	2.00	3.20	0.50	0.90	30.00	14.00
8f24c4f7-9380-4aac-bb48-9e5d5731be89	Mosaic	USA	11.50	13.50	Dual Purpose	{Blueberry,Mango,Pine,Tropical}	{Citra,Simcoe,"Idaho 7"}	Field note: Chameleon berry/tropical; crop year shifts profile—taste lots before locking ratios.	2026-03-29 22:39:20.045422+00	Pellet	3.80	4.80	1.60	2.40	44.00	8.00
5028e7c4-ebf3-412b-a815-5dbc821df287	Hallertau Mittelfrüh	Germany	3.50	5.50	Aroma	{Floral,Spice,Hay,"Mild citrus"}	{"Hallertau Tradition",Spalt,Tettnang}	Field note: Noble Hallertau landrace—floral-spice delicacy for lagers and subtle Belgians.	2026-03-29 22:39:20.045422+00	Pellet	3.00	4.50	0.60	1.00	25.00	12.50
85953bc7-f05f-4930-a72f-9812a4a0f1f1	Galaxy	Australia	13.50	15.00	Dual Purpose	{Passionfruit,Peach,Citrus}	{Citra,Mosaic,"Vic Secret"}	Field note: Intense Southern Hemisphere tropicals—often carries the dry hop alone.	2026-03-29 23:00:49.069921+00	Pellet	5.80	6.50	2.80	3.60	55.00	5.00
a59d504d-c495-406d-b74d-6a459496c95b	Vic Secret	Australia	14.00	17.00	Dual Purpose	{Pineapple,Tropical,Pine}	{Galaxy,Ella,Topaz}	Field note: High-oil Australian workhorse; pairs with Galaxy for layered tropical canopy.	2026-03-29 23:00:49.069921+00	Pellet	6.00	7.20	2.40	3.20	48.00	7.00
3e6563c2-afcc-42ba-9dc7-0ac99f9e641b	Motueka	New Zealand	6.50	8.50	Aroma	{Lime,Mojito,"Citrus zest"}	{"Nelson Sauvin",Riwaka,Waimea}	Field note: Distinct lime-zest lift—excellent whirlpool and dry hop for saison and pale ale.	2026-03-29 23:00:49.069921+00	Pellet	4.50	5.50	1.00	1.50	62.00	6.50
02300e57-288e-406b-9bf6-e0a138ef82c8	Rakau	New Zealand	9.00	11.00	Dual Purpose	{"Stone fruit",Apricot,Citrus}	{Motueka,"Nelson Sauvin",Pacifica}	Field note: Orchard fruit forward; useful bridge between classic citrus and NZ winey hops.	2026-03-29 23:00:49.069921+00	Pellet	4.00	5.00	1.20	1.80	54.00	7.50
a0d78888-d3ec-4a13-8e1d-cf9da1c7821c	Ella	Australia	13.50	16.50	Dual Purpose	{Floral,Spice,Tropical}	{Galaxy,"Vic Secret",Enigma}	Field note: Australian dual with floral spine—balance against louder tropical partners.	2026-03-29 23:00:49.069921+00	Pellet	5.50	6.80	2.00	2.80	46.00	8.50
cc0afbae-0bb7-4dbb-a798-487ff2bc40cb	Tettnanger	Germany	3.50	5.50	Aroma	{Spice,Herbal,Floral}	{Saaz,"Spalter Select","Hallertau Mittelfrüh"}	Field note: Noble spice-floral classic for German lagers; low alpha rewards late timing.	2026-03-29 23:00:49.069921+00	Pellet	3.00	4.50	0.50	0.90	24.00	13.00
b7c789a1-7443-4ce3-a71e-d09da23f1c13	Spalter Select	Germany	3.50	5.50	Aroma	{Floral,Spice,Herbal}	{Tettnanger,Saaz,"Hallertau Tradition"}	Field note: Spalt-type noble selection—clean lager aromatics with mild spice.	2026-03-29 23:00:49.069921+00	Pellet	3.20	4.80	0.50	0.85	26.00	12.00
baed191d-e879-4b50-9a51-748b5a18b86d	Fuggle	UK	3.50	5.50	Aroma	{Earthy,Woody,"Mild spice"}	{"East Kent Goldings",Willamette,"Styrian Golding"}	Field note: Historic English aroma—earthy-woody; cornerstone of traditional bitters.	2026-03-29 23:00:49.069921+00	Pellet	2.00	3.00	0.60	1.00	34.00	11.00
ef03a2dc-6d56-4131-ae66-21b5892f8fbe	Amarillo	USA	8.00	11.00	Dual Purpose	{Orange,Citrus,Floral}	{Centennial,Cascade,Simcoe}	Field note: Orange-oil aromatics; mid-high alpha suits dual-use schedules.	2026-03-29 23:00:49.069921+00	Pellet	6.00	7.50	1.00	1.60	64.00	5.50
d978fc78-1689-4dc7-bc94-4639629c8ad3	El Dorado	USA	13.00	17.00	Dual Purpose	{Watermelon,Pear,"Stone fruit"}	{Mosaic,Citra,Sabro}	Field note: Bold fruit-forward US variety—dry hop showcases watermelon-pear notes.	2026-03-29 23:00:49.069921+00	Pellet	6.50	8.00	2.40	3.00	52.00	6.00
ddb8c3ee-000c-4829-a07a-c033188c850c	Sabro	USA	12.00	15.00	Dual Purpose	{Coconut,Citrus,Cream}	{Citra,Mosaic,"El Dorado"}	Field note: Distinct coconut-citrus; Cryo concentrates—blend carefully to avoid soap perception.	2026-03-29 23:00:49.069921+00	Cryo	5.00	6.50	2.60	3.40	48.00	9.00
8dbea387-e830-4a6a-8559-77791fab0da8	Idaho 7	USA	11.00	15.00	Dual Purpose	{Tropical,Pine,"Black tea"}	{Mosaic,Simcoe,Strata}	Field note: Pacific Northwest “fruit punch” with resin backbone—modern hazy staple.	2026-03-29 23:00:49.069921+00	Pellet	4.50	5.80	1.80	2.50	46.00	8.00
a4b29666-b83f-4891-a88f-c13967e783a9	Azacca	USA	14.00	16.00	Dual Purpose	{Mango,Pineapple,Citrus}	{Citra,Mosaic,"El Dorado"}	Field note: Bright tropical top notes; high alpha keeps cost-efficient bittering.	2026-03-29 23:00:49.069921+00	Pellet	4.80	5.80	1.40	2.00	58.00	6.50
c91ebda7-065a-497d-b0f1-09bb2a60c2fb	Cashmere	USA	7.70	9.70	Dual Purpose	{Melon,Citrus,Coconut}	{Citra,Sabro,"El Dorado"}	Field note: Soft melon-citrus; lower alpha than many US duals—favor aroma roles.	2026-03-29 23:00:49.069921+00	Pellet	5.50	6.80	1.20	1.70	55.00	7.00
f350914c-e017-4e5a-a727-cdb32849c846	Styrian Golding	Slovenia	3.50	5.50	Aroma	{Spice,Herbal,Earthy}	{Fuggle,"East Kent Goldings",Saaz}	Field note: Fuggle descendant grown in Slovenia—earthy-spice English/EU crossover.	2026-03-29 23:00:49.069921+00	Pellet	2.50	3.50	0.55	0.95	32.00	11.50
ebca24c8-fc6a-4d3f-9406-c51df27428fa	Northern Brewer	Germany	7.00	10.00	Dual Purpose	{Woody,Pine,Mint}	{Chinook,Columbus,Magnum}	Field note: Classic woody-mint bittering with some aroma utility—California common.	2026-03-29 23:00:49.069921+00	Pellet	4.00	5.50	1.40	2.00	38.00	10.00
36b4f97b-8ae0-47d3-bc5f-ddb1f8cae7fc	Chinook	USA	12.00	14.00	Dual Purpose	{Pine,Grapefruit,Spice}	{Columbus,Simcoe,Nugget}	Field note: Aggressive pine-grapefruit; excellent bittering and late additions.	2026-03-29 23:00:49.069921+00	Pellet	3.00	4.20	1.80	2.40	35.00	11.00
696c0f24-31e0-4b5e-be65-628c76d6f1b5	Columbus	USA	14.00	18.00	Bittering	{Pungent,Citrus,Resin}	{Chinook,Tomahawk,Zeus}	Field note: CTZ family—dank resin bittering; use early unless you want bold aromatics.	2026-03-29 23:00:49.069921+00	Pellet	4.50	5.50	1.80	2.50	32.00	10.50
f7e3c836-f1a8-40a1-a25f-6a37d745f5ec	CTZ	USA	14.50	17.50	Bittering	{Pungent,Citrus,Dank}	{Columbus,Chinook,Magnum}	Field note: Columbus/Tomahawk/Zeus—high-alpha utility bittering hop.	2026-03-29 23:00:49.069921+00	Pellet	4.50	5.50	1.70	2.40	31.00	10.00
893e698e-677e-4163-9b74-f89d7191f463	Warrior	USA	15.00	18.00	Bittering	{Clean,"Mild citrus"}	{Magnum,Columbus,Nugget}	Field note: Ultra-clean high-alpha bittering—minimal flavor carryover.	2026-03-29 23:00:49.069921+00	Pellet	5.00	6.00	1.50	2.00	28.00	9.00
10e71bda-dcc2-4b51-9b65-5549dd9ea619	Willamette	USA	4.00	6.00	Aroma	{Floral,Herbal,Earthy}	{Fuggle,Tettnanger,Goldings}	Field note: US Fuggle-type workhorse for English and American amber styles.	2026-03-29 23:00:49.069921+00	Pellet	3.00	4.50	0.80	1.20	36.00	10.00
9945f991-9104-46db-bf47-cae6392153fa	Crystal	USA	3.50	5.50	Aroma	{Woody,Spice,Citrus}	{"Hallertau Mittelfrüh",Liberty,"Mt Hood"}	Field note: Domestic noble-type aroma—mild spice and citrus peel.	2026-03-29 23:00:49.069921+00	Pellet	4.50	6.00	0.80	1.10	40.00	9.00
8709f2f4-ad12-45f5-9b42-ca7b38a900cf	Strata	USA	9.50	12.50	Dual Purpose	{Passionfruit,Berry,Dank}	{Mosaic,"Idaho 7",Simcoe}	Field note: Oregon-bred layered fruit with dank undertow—modern blend builder.	2026-03-29 23:00:49.069921+00	Pellet	4.00	5.20	2.00	2.80	50.00	7.50
a6374620-4bca-44e8-ba7e-b9d241d73969	Topaz	Australia	13.50	17.50	Dual Purpose	{Lychee,Resin,Tropical}	{Galaxy,"Vic Secret",Ella}	Field note: Australian high-alpha with lychee when used cold-side.	2026-03-29 23:00:49.069921+00	Pellet	6.00	7.50	2.20	2.90	52.00	6.50
448d13ff-6c7f-4249-84a1-c76487deaebc	Enigma	Australia	16.00	18.00	Dual Purpose	{"Red wine",Tropical,Berries}	{Galaxy,Ella,"Vic Secret"}	Field note: Winey-tropical complexity—powerful; small percentages in blends.	2026-03-29 23:00:49.069921+00	Pellet	6.50	7.80	2.00	2.60	46.00	7.00
7fb79294-b1db-4c7d-9304-3f1a56ee7688	Pahto	USA	19.00	21.00	Bittering	{Neutral,Clean}	{Warrior,Magnum,Columbus}	Field note: Ultra-high alpha bittering brick—aroma essentially neutral.	2026-03-29 23:00:49.069921+00	Pellet	7.00	8.50	1.20	1.60	22.00	8.00
b6193025-58d8-4e95-bd1b-e23bf987b853	Bravo	USA	14.00	17.00	Bittering	{Floral,Fruity,Vanilla}	{Magnum,Warrior,Nugget}	Field note: High-alpha with slight floral-fruit whisper compared to CTZ.	2026-03-29 23:00:49.069921+00	Pellet	6.00	7.00	1.60	2.10	30.00	9.50
f23d85b8-4d1f-4357-bbd1-cd2a05223a0a	Sterling	USA	4.50	6.50	Aroma	{Citrus,Herbal,Spice}	{Saaz,"Mt Hood",Crystal}	Field note: Saaz-type domestic noble substitute—citrus-herbal spice.	2026-03-29 23:00:49.069921+00	Pellet	4.00	5.50	0.80	1.20	38.00	10.00
1a642559-1947-4098-885c-ab86be61f7b4	Perle	Germany	6.00	9.50	Dual Purpose	{Spice,Floral,Mint}	{"Northern Brewer","Hallertau Tradition",Magnum}	Field note: German dual with mint-spice; versatile in alt and lager.	2026-03-29 23:00:49.069921+00	Pellet	3.50	5.00	0.90	1.30	35.00	11.00
e0ca5a3a-c566-4c0f-aaf3-d8a2cb274ecd	Hersbrucker	Germany	2.50	4.50	Aroma	{Floral,Herbal,Spice}	{"Hallertau Mittelfrüh",Tettnanger,Spalt}	Field note: Soft noble aroma hop—traditional German lagers.	2026-03-29 23:00:49.069921+00	Pellet	2.50	4.00	0.45	0.75	22.00	12.50
0c99fb71-69a1-45e4-ad55-9b67c4cf9a13	Liberty	USA	3.00	5.00	Aroma	{Citrus,Floral,Spice}	{"Hallertau Mittelfrüh",Crystal,"Mt Hood"}	Field note: Hallertau Mittelfrüh descendant—mild citrus noble character.	2026-03-29 23:00:49.069921+00	Pellet	3.00	4.50	0.70	1.00	28.00	11.00
2190badc-decd-4cf0-b86d-b2462e822813	Mt Hood	USA	4.00	7.00	Aroma	{Herbal,Spice,Floral}	{Liberty,Crystal,Hallertau}	Field note: US noble-type triploid—clean herbal spice for lagers.	2026-03-29 23:00:49.069921+00	Pellet	4.50	6.00	0.80	1.10	30.00	10.50
266083e8-d12a-4c81-935e-c54a19b28ba8	Ultra	USA	2.00	4.50	Aroma	{Spice,Floral,Citrus}	{Hallertau,Crystal,Liberty}	Field note: Low-alpha Hallertau cross—delicate aroma for subtle beers.	2026-03-29 23:00:49.069921+00	Pellet	3.50	5.00	0.55	0.90	26.00	11.00
3720e20b-38bc-4059-81c0-b8e21d8f2414	Nugget	USA	12.50	16.00	Bittering	{Woody,Spice,Pine}	{Columbus,Chinook,Magnum}	Field note: Reliable high-alpha bittering with mild herbal spice.	2026-03-29 23:00:49.069921+00	Pellet	4.00	5.50	1.60	2.20	30.00	10.00
dd639435-8950-4205-a0ca-f0041b3b2f51	Ahtanum	USA	5.20	6.50	Aroma	{Citrus,Floral,Earthy}	{Cascade,Amarillo,Willamette}	Field note: Cascade-like citrus-floral with softer edge—APA friendly.	2026-03-29 23:00:49.069921+00	Pellet	4.80	6.00	0.85	1.20	48.00	8.50
35ded8ac-6ccb-403c-bc13-80e31b04727a	Summit	USA	16.00	18.00	Bittering	{Citrus,Onion,Garlic}	{Simcoe,Columbus,Warrior}	Field note: Extreme alpha—can show onion/garlic at high dry-hop loads; use judiciously.	2026-03-29 23:00:49.069921+00	Pellet	5.00	6.50	2.00	2.80	28.00	9.00
395974fd-3371-48c8-adc7-64fe459fa4ef	Loral	USA	10.00	12.00	Dual Purpose	{Floral,Citrus,Herbal}	{Hallertau,Mosaic,Sabro}	Field note: “Noble meets new world”—floral-citrus bridge hop.	2026-03-29 23:00:49.069921+00	Pellet	4.50	5.50	1.60	2.20	42.00	9.00
694022ba-9ed9-4016-9298-b3285ab1753e	Hallertau Blanc	Germany	9.00	12.00	Aroma	{Wine,Grape,Citrus}	{"Nelson Sauvin",Hallertau,Mandarina}	Field note: German wine-grape aromatics—excellent with NZ varieties.	2026-03-29 23:00:49.069921+00	Pellet	4.00	5.50	1.20	1.80	38.00	8.50
\.


--
-- Data for Name: inventory; Type: TABLE DATA; Schema: api; Owner: postgres
--

COPY api.inventory (id, user_id, item_type, item_id, quantity, unit, updated_at) FROM stdin;
26f67228-a981-41ec-8534-5582b7bc3015	0f724598-6082-4b93-b5e4-251a97d2a320	yeast	865f1b1f-22ba-4783-bc79-9e3189053480	3.0000	pkg	2026-04-05 20:54:39.861+00
\.


--
-- Data for Name: profiles; Type: TABLE DATA; Schema: api; Owner: postgres
--

COPY api.profiles (id, username, created_at, temp_unit, volume_unit, weight_unit, gravity_display, default_efficiency, evaporation_l_per_hr, default_batch_size, public_code) FROM stdin;
a0000000-0000-0000-0000-000000000010	community_beginner	2026-03-28 22:00:01.816423+00	F	gal	lb	sg	72.00	3.800	19	yc7ai
a0000000-0000-0000-0000-000000000001	vessel_brewing	2026-03-25 15:07:19.619452+00	F	gal	lb	sg	72.00	3.800	19	du3k5
a0000000-0000-0000-0000-000000000002	maltwright	2026-03-25 15:07:19.619452+00	F	gal	lb	sg	72.00	3.800	19	3fkbf
a0000000-0000-0000-0000-000000000003	hopyard	2026-03-25 15:07:19.619452+00	F	gal	lb	sg	72.00	3.800	19	rje6s
a0000000-0000-0000-0000-000000000011	community_reference	2026-03-28 22:00:01.816423+00	F	gal	lb	sg	72.00	3.800	19	bw765
d43cd820-a9f8-408c-8132-a41d0d98c42c	justkemte	2026-03-29 21:24:57.764496+00	F	gal	lb	sg	72.00	3.800	3.8	4mmz7
0f724598-6082-4b93-b5e4-251a97d2a320	justinkennethemter	2026-03-25 16:34:36.2738+00	F	gal	lb	sg	72.00	3.800	3.8	q282j
87ace3c1-eb8d-47d9-a7ae-1d7700a97926	justinemteramz	2026-04-15 18:21:18.581301+00	F	gal	lb	sg	72.00	3.800	19	qeq46
user_3CYBgW7bmTFed4QYv0wCbo40XVy	justinkennethemter	2026-04-22 08:16:05.748862+00	F	gal	lb	sg	72.00	3.800	19	cpy53
\.


--
-- Data for Name: recipes; Type: TABLE DATA; Schema: api; Owner: postgres
--

COPY api.recipes (id, user_id, name, data, is_private, forked_from_id, created_at, updated_at, style_id, complexity, views) FROM stdin;
df2169e1-67ae-4ce3-8905-bd028f4ee139	0f724598-6082-4b93-b5e4-251a97d2a320	Cascade Session IPA (Modified)	{"abv": 4.2, "ibu": 42, "srm": 5, "notes": "A crushable, hop-forward session IPA built entirely around Cascade. The low ABV lets the citrus and floral hop character shine without palate fatigue. Ferment on the cool side of the range for a clean finish. Great warm-weather brewer.", "style": "Session IPA", "yeast": {"lab": "White Labs", "code": "WLP001", "name": "California Ale", "notes": "Clean fermenter that lets the hops do the talking. Pitch at 65°F and hold there for the cleanest possible profile.", "style": "American Ale", "tempMax": 68, "tempMin": 65, "flavorProfile": ["Clean", "Neutral", "Crisp Finish"], "attenuationMax": 80, "attenuationMin": 73, "alcoholTolerance": "Very High", "flocculationLevel": "Medium"}, "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g1", "name": "Pale 2-Row (US)", "unit": "lb", "weight": 8, "purpose": "Base", "lovibond": 1.8, "percentage": 84.2}, {"id": "g2", "name": "Crystal 15L", "unit": "lb", "weight": 0.75, "purpose": "Light Sweetness", "lovibond": 15, "percentage": 7.9}, {"id": "g3", "name": "Carapils (Dextrin)", "unit": "lb", "weight": 0.75, "purpose": "Head Retention", "lovibond": 1.3, "percentage": 7.9}], "efficiency": 74, "hopSchedule": [{"id": "h1", "name": "Cascade", "time": 60, "unit": "oz", "weight": 0.75, "addition": "bittering", "timeUnit": "min", "alphaAcid": 5.5, "ibuContribution": 22}, {"id": "h2", "name": "Cascade", "time": 20, "unit": "oz", "weight": 0.5, "addition": "flavor", "timeUnit": "min", "alphaAcid": 5.5, "ibuContribution": 12}, {"id": "h3", "name": "Cascade", "time": 5, "unit": "oz", "weight": 0.75, "addition": "aroma", "timeUnit": "min", "alphaAcid": 5.5, "ibuContribution": 8}, {"id": "h4", "name": "Cascade", "time": 3, "unit": "oz", "weight": 2, "addition": "dry hop", "timeUnit": "days", "alphaAcid": 5.5, "ibuContribution": 0}], "finalGravity": 1.008, "originalGravity": 1.045}	t	bf41f9ca-473a-4cba-8de5-6cfa1a9fec99	2026-03-25 20:37:37.452789+00	2026-03-29 23:53:12.751274+00	\N	3	0
08616334-d775-4aab-8787-3711c8479239	0f724598-6082-4b93-b5e4-251a97d2a320	YeastCoast Heritage Lager	{"abv": 5.1, "ibu": 25, "srm": 4, "notes": "The Heritage Lager. A precision-engineered bridge between the crispness of Northern Germany and the malt soul of the North Atlantic. Cold-conditioned for ultimate clarity. Clean, floral, and timeless.\\n\\nFERMENTATION PROTOCOL — Lager fermentation demands patience and temperature discipline:\\n\\n1. PITCH COLD: Pitch WLP830 at 48–50°F (9–10°C). Use 2× the standard pitch rate (high cell count or 2 packs for 5.5 gal) to prevent stress esters.\\n2. PRIMARY: Hold at 50–52°F for 10–14 days until gravity approaches terminal (within 3–4 points of FG).\\n3. DIACETYL REST (critical): Raise temperature to 60–65°F (15–18°C) for 48–72 hours. This activates yeast to reabsorb diacetyl — the buttery compound that plagues poorly-conditioned lagers. Do not skip this step.\\n4. CRASH: Once diacetyl rest is complete and a sample tastes clean, drop to 34°F (1°C) at a rate of 5°F per day.\\n5. LAGER: Cold-condition at 34°F for a minimum of 4 weeks (6–8 weeks for true Pilsner character). The longer the lager, the cleaner and clearer the beer.\\n6. TRANSFER: Gelatin fine or Biofine Clear optional — the long cold rest alone will produce a brilliantly clear, straw-gold pint.", "style": "German Pilsner / Vienna Hybrid", "yeast": {"lab": "White Labs", "code": "WLP830", "name": "German Lager", "notes": "The industry standard for clean, crisp lager production. Ferments extremely clean with virtually no ester production at proper temperatures. Requires a mandatory diacetyl rest (60–65°F for 48–72 hrs) before crashing to eliminate any residual diacetyl. Reward for patience: a glass of straw-gold perfection.", "style": "German Lager Yeast", "tempMax": 55, "tempMin": 50, "flavorProfile": ["Ultra Clean", "Crisp", "Floral", "Slight Sulfur (CO2 off)", "Zero Esters"], "attenuationMax": 79, "attenuationMin": 74, "alcoholTolerance": "Medium (9%)", "flocculationLevel": "Medium"}, "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g1", "name": "Premium German Pilsner Malt", "unit": "lb", "weight": 8.5, "purpose": "Base Malt — contributes the delicate, bready sweetness characteristic of North German Pilsner", "lovibond": 1.7, "percentage": 89.5}, {"id": "g2", "name": "Vienna Malt", "unit": "lb", "weight": 1.0, "purpose": "Character Malt — adds a Sam Adams-style golden hue and a subtle biscuit/bread-crust depth without obscuring the pale straw color", "lovibond": 3.5, "percentage": 10.5}], "difficulty": 7, "efficiency": 75, "hopSchedule": [{"id": "h1", "name": "Hallertau Mittelfrüh", "time": 60, "unit": "oz", "weight": 1.5, "addition": "bittering", "timeUnit": "min", "alphaAcid": 4.0, "ibuContribution": 18}, {"id": "h2", "name": "Hallertau Mittelfrüh", "time": 15, "unit": "oz", "weight": 0.75, "addition": "flavor", "timeUnit": "min", "alphaAcid": 4.0, "ibuContribution": 5}, {"id": "h3", "name": "Saaz", "time": 5, "unit": "oz", "weight": 1.0, "addition": "aroma", "timeUnit": "min", "alphaAcid": 3.5, "ibuContribution": 2}], "finalGravity": 1.009, "originalGravity": 1.048}	f	\N	2026-03-26 02:05:16.203679+00	2026-03-29 23:53:12.751274+00	5D	4	0
bf41f9ca-473a-4cba-8de5-6cfa1a9fec99	a0000000-0000-0000-0000-000000000001	Cascade Session IPA	{"abv": 4.2, "ibu": 42, "srm": 5, "notes": "A crushable, hop-forward session IPA built entirely around Cascade. The low ABV lets the citrus and floral hop character shine without palate fatigue. Ferment on the cool side of the range for a clean finish. Great warm-weather brewer.", "style": "Session IPA", "yeast": {"lab": "White Labs", "code": "WLP001", "name": "California Ale", "notes": "Clean fermenter that lets the hops do the talking. Pitch at 65°F and hold there for the cleanest possible profile.", "style": "American Ale", "tempMax": 68, "tempMin": 65, "flavorProfile": ["Clean", "Neutral", "Crisp Finish"], "attenuationMax": 80, "attenuationMin": 73, "alcoholTolerance": "Very High", "flocculationLevel": "Medium"}, "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g1", "name": "Pale 2-Row (US)", "unit": "lb", "weight": 8.0, "purpose": "Base", "lovibond": 1.8, "percentage": 84.2}, {"id": "g2", "name": "Crystal 15L", "unit": "lb", "weight": 0.75, "purpose": "Light Sweetness", "lovibond": 15, "percentage": 7.9}, {"id": "g3", "name": "Carapils (Dextrin)", "unit": "lb", "weight": 0.75, "purpose": "Head Retention", "lovibond": 1.3, "percentage": 7.9}], "efficiency": 74, "hopSchedule": [{"id": "h1", "name": "Cascade", "time": 60, "unit": "oz", "weight": 0.75, "addition": "bittering", "timeUnit": "min", "alphaAcid": 5.5, "ibuContribution": 22}, {"id": "h2", "name": "Cascade", "time": 20, "unit": "oz", "weight": 0.5, "addition": "flavor", "timeUnit": "min", "alphaAcid": 5.5, "ibuContribution": 12}, {"id": "h3", "name": "Cascade", "time": 5, "unit": "oz", "weight": 0.75, "addition": "aroma", "timeUnit": "min", "alphaAcid": 5.5, "ibuContribution": 8}, {"id": "h4", "name": "Cascade", "time": 3, "unit": "oz", "weight": 2.0, "addition": "dry hop", "timeUnit": "days", "alphaAcid": 5.5, "ibuContribution": 0}], "finalGravity": 1.008, "originalGravity": 1.045}	f	\N	2026-03-25 15:07:19.619452+00	2026-03-29 23:53:12.751274+00	\N	3	0
0d0002bf-9bdc-4430-9355-48eab1a79d22	d43cd820-a9f8-408c-8132-a41d0d98c42c	Citra Smash Pale Ale	{"abv": 5.7, "ibu": 52, "srm": 5, "dbId": "0d0002bf-9bdc-4430-9355-48eab1a79d22", "notes": "Starter calibration batch (CORE_PROGRAM_01). Mash at 67°C (152.6°F) for a fermentable wort; single base malt keeps the grist audit trivial. Dry hop on day 7 for peak Citra saturation.", "style": "American Pale Ale (Smash)", "yeast": {"lab": "SafAle", "code": "US-05", "name": "American Ale", "notes": "Clean; lets Citra dominate. Pitch cool, allow free-rise into low 70s °F.", "style": "Ale", "tempMax": 72, "tempMin": 59, "flavorProfile": ["Neutral", "Slight stone-fruit ester when warm"], "attenuationMax": 77, "attenuationMin": 73, "alcoholTolerance": "Medium (9%)", "flocculationLevel": "Medium"}, "userId": "d43cd820-a9f8-408c-8132-a41d0d98c42c", "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g-smash-base", "name": "Pale 2-Row (US)", "unit": "lb", "weight": 11, "purpose": "Base (Smash)", "lovibond": 1.8, "percentage": 100}], "isPrivate": true, "difficulty": 3, "efficiency": 72, "hopSchedule": [{"id": "h-citra-60", "name": "Citra", "time": 60, "unit": "oz", "weight": 0.6, "addition": "bittering", "timeUnit": "min", "alphaAcid": 12.5, "ibuContribution": 32}, {"id": "h-citra-10", "name": "Citra", "time": 10, "unit": "oz", "weight": 1, "addition": "flavor", "timeUnit": "min", "alphaAcid": 12.5, "ibuContribution": 14}, {"id": "h-citra-fo", "name": "Citra", "time": 0, "unit": "oz", "weight": 2, "addition": "aroma", "timeUnit": "flameout", "alphaAcid": 12.5, "ibuContribution": 6}, {"id": "h-citra-dh", "name": "Citra", "time": 3, "unit": "oz", "weight": 3, "addition": "dry hop", "timeUnit": "days", "alphaAcid": 12.5, "ibuContribution": 0}], "finalGravity": 1.011, "forkedFromId": null, "starterPackage": "CORE_PROGRAM_01", "originalGravity": 1.054, "fermentationSchedule": [{"days": 10, "name": "Primary", "notes": "Hold steady; add dry hop around day 7.", "tempMax": 70, "tempMin": 66}, {"days": 3, "name": "Dry hop contact", "notes": "Biotransformation window — avoid O₂ pickup.", "tempMax": 68, "tempMin": 66}]}	f	\N	2026-03-29 21:32:09.416905+00	2026-03-29 23:53:12.751274+00	18B	2	0
f5a8183d-0812-4c4a-b315-dcfe8b4d443b	a0000000-0000-0000-0000-000000000001	Belgian Tripel	{"abv": 8.7, "ibu": 28, "srm": 5, "notes": "A classic Trappist-inspired tripel. The Belgian candi sugar lightens the body and dries the finish, letting the yeast esters carry complexity. Allow a full diacetyl rest at 72°F before cold crashing. Lager for 4 weeks for best results. Deceptively strong — drinks dangerously light.", "style": "Belgian Tripel", "yeast": {"lab": "White Labs", "code": "WLP500", "name": "Monastery Ale", "notes": "The gold standard for Belgian strong ales. Start cool at 65°F for the first 3 days, then ramp to 72°F to ensure full attenuation. Low flocculation means this needs time to clear — patience is rewarded.", "style": "Belgian Ale", "tempMax": 72, "tempMin": 65, "flavorProfile": ["Fruity Esters", "Spicy Phenols", "Dry Finish", "Floral"], "attenuationMax": 80, "attenuationMin": 75, "alcoholTolerance": "High", "flocculationLevel": "Low"}, "boilTime": 75, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g1", "name": "Belgian Pilsner", "unit": "lb", "weight": 13.0, "purpose": "Base", "lovibond": 1.6, "percentage": 81.3}, {"id": "g2", "name": "Belgian Clear Candi Sugar", "unit": "lb", "weight": 2.0, "purpose": "Fermentables / Body", "lovibond": 0, "percentage": 12.5}, {"id": "g3", "name": "Aromatic Malt", "unit": "lb", "weight": 1.0, "purpose": "Malt Depth", "lovibond": 26, "percentage": 6.3}], "efficiency": 72, "hopSchedule": [{"id": "h1", "name": "Styrian Goldings", "time": 60, "unit": "oz", "weight": 1.0, "addition": "bittering", "timeUnit": "min", "alphaAcid": 5.4, "ibuContribution": 22}, {"id": "h2", "name": "Hallertau Mittelfrüh", "time": 15, "unit": "oz", "weight": 0.5, "addition": "flavor", "timeUnit": "min", "alphaAcid": 4.5, "ibuContribution": 6}], "finalGravity": 1.010, "originalGravity": 1.082}	f	\N	2026-03-25 15:07:19.619452+00	2026-03-29 23:53:12.751274+00	\N	3	0
e77b7c94-cb98-47a1-8188-38dda84824ae	a0000000-0000-0000-0000-000000000002	Munich Dunkel	{"abv": 5.0, "ibu": 18, "srm": 22, "notes": "A malt-forward Munich Dunkel built on a dark Munich malt backbone. The Carafa III (dehusked) adds deep ruby colour without harshness. A decoction mash is traditional but a single-infusion at 154°F works well. Lager at 34°F for 4–6 weeks for that smooth, clean malt profile. The hallmark of this style is restraint — let the malt sing.", "style": "Munich Dunkel", "yeast": {"lab": "White Labs", "code": "WLP833", "name": "German Bock Lager", "notes": "A classic Southern German lager strain that produces a clean, malt-forward profile. Ferment at 50°F, then ramp to 58°F for the diacetyl rest, then lager at 34°F. Takes time but the results are worth it.", "style": "German Lager", "tempMax": 55, "tempMin": 48, "flavorProfile": ["Clean Malt", "Bready", "Slight Sweetness", "No Fruitiness"], "attenuationMax": 76, "attenuationMin": 70, "alcoholTolerance": "Medium", "flocculationLevel": "Medium"}, "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g1", "name": "Munich Malt (Dark)", "unit": "lb", "weight": 9.0, "purpose": "Base / Malt Character", "lovibond": 9, "percentage": 75.0}, {"id": "g2", "name": "Pilsner Malt", "unit": "lb", "weight": 2.0, "purpose": "Lighten Body", "lovibond": 1.6, "percentage": 16.7}, {"id": "g3", "name": "CaraMunich II", "unit": "lb", "weight": 0.75, "purpose": "Caramel / Color", "lovibond": 46, "percentage": 6.3}, {"id": "g4", "name": "Carafa III (Dehusked)", "unit": "lb", "weight": 0.25, "purpose": "Color (no astringency)", "lovibond": 525, "percentage": 2.1}], "efficiency": 72, "hopSchedule": [{"id": "h1", "name": "Hallertau Mittelfrüh", "time": 60, "unit": "oz", "weight": 1.0, "addition": "bittering", "timeUnit": "min", "alphaAcid": 4.5, "ibuContribution": 14}, {"id": "h2", "name": "Hallertau Mittelfrüh", "time": 15, "unit": "oz", "weight": 0.5, "addition": "flavor", "timeUnit": "min", "alphaAcid": 4.5, "ibuContribution": 4}], "finalGravity": 1.012, "originalGravity": 1.052}	f	\N	2026-03-25 15:07:19.619452+00	2026-03-29 23:53:12.751274+00	\N	3	0
3989e4e7-5e51-48da-b944-d9a5a63c2435	a0000000-0000-0000-0000-000000000003	Juice Bomb NEIPA	{"abv": 6.8, "ibu": 42, "srm": 4, "notes": "Maximum juice, minimum bitterness. The oat and wheat bill creates a pillowy, hazy body that suspends hop oils for weeks. Two dry hop additions with Citra and Galaxy give tropical and citrus layers. Critical: add first dry hop at high krausen (day 2) while fermentation is still active to biotransform the hops. Package quickly after cold crash to preserve haze and aroma.", "style": "New England IPA", "yeast": {"lab": "Wyeast", "code": "1318", "name": "London Ale III", "notes": "The definitive NEIPA yeast. High flocculation means you can skip gelatin and still get a pour that looks hazy-on-purpose rather than murky. Biotransformation at high krausen is real with this strain — the hop character becomes richer and more complex.", "style": "British Ale", "tempMax": 74, "tempMin": 64, "flavorProfile": ["Soft Mouthfeel", "Slight Fruitiness", "Neutral", "Enhances Hop Esters"], "attenuationMax": 77, "attenuationMin": 73, "alcoholTolerance": "Medium", "flocculationLevel": "High"}, "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g1", "name": "Pale 2-Row (US)", "unit": "lb", "weight": 8.0, "purpose": "Base", "lovibond": 1.8, "percentage": 60.4}, {"id": "g2", "name": "Flaked Oats", "unit": "lb", "weight": 2.5, "purpose": "Haze / Body / Mouthfeel", "lovibond": 1.0, "percentage": 18.9}, {"id": "g3", "name": "White Wheat Malt", "unit": "lb", "weight": 2.0, "purpose": "Haze / Protein", "lovibond": 2.4, "percentage": 15.1}, {"id": "g4", "name": "Carapils (Dextrin)", "unit": "lb", "weight": 0.75, "purpose": "Head Retention", "lovibond": 1.3, "percentage": 5.7}], "efficiency": 74, "hopSchedule": [{"id": "h1", "name": "Columbus (CTZ)", "time": 60, "unit": "oz", "weight": 0.5, "addition": "bittering", "timeUnit": "min", "alphaAcid": 15.0, "ibuContribution": 30}, {"id": "h2", "name": "Citra", "time": "flameout", "unit": "oz", "weight": 1.0, "addition": "aroma", "timeUnit": "flameout", "alphaAcid": 12.0, "ibuContribution": 8}, {"id": "h3", "name": "Mosaic", "time": "flameout", "unit": "oz", "weight": 1.0, "addition": "aroma", "timeUnit": "flameout", "alphaAcid": 11.5, "ibuContribution": 4}, {"id": "h4", "name": "Citra", "time": 4, "unit": "oz", "weight": 2.0, "addition": "dry hop", "timeUnit": "days", "alphaAcid": 12.0, "ibuContribution": 0}, {"id": "h5", "name": "Galaxy", "time": 4, "unit": "oz", "weight": 2.0, "addition": "dry hop", "timeUnit": "days", "alphaAcid": 14.0, "ibuContribution": 0}, {"id": "h6", "name": "Mosaic", "time": 2, "unit": "oz", "weight": 1.5, "addition": "dry hop", "timeUnit": "days", "alphaAcid": 11.5, "ibuContribution": 0}], "finalGravity": 1.013, "originalGravity": 1.067}	f	\N	2026-03-25 15:07:19.619452+00	2026-03-29 23:53:12.751274+00	\N	3	0
ce5e4701-cffa-488d-8920-62c865c7d0cc	a0000000-0000-0000-0000-000000000003	Imperial Black Site Stout	{"abv": 10.5, "ibu": 65, "srm": 50, "notes": "A full-on imperial stout built for aging. The oat addition gives a luxurious silkiness that integrates beautifully after 3–6 months in the bottle. Split a batch onto bourbon-soaked oak cubes for a barrel-aged variant. Mash at 154°F for body; higher mash temp increases final gravity and improves aging stability. Plan your brew day early — this is a 6+ hour commitment. Worth every minute.", "style": "Russian Imperial Stout", "yeast": {"lab": "White Labs", "code": "WLP007", "name": "Dry English Ale", "notes": "High attenuation is critical for a stout of this gravity — WLP007 will drive it to a dry, satisfying finish. Pitch a large starter (2L stir plate). Ferment at 68°F. Once primary is done, ramp to 72°F for a full week to ensure every last gravity point is consumed before packaging.", "style": "British Ale", "tempMax": 70, "tempMin": 65, "flavorProfile": ["Dry Finish", "High Attenuation", "Clean", "Slight Fruitiness"], "attenuationMax": 85, "attenuationMin": 80, "alcoholTolerance": "High", "flocculationLevel": "High"}, "boilTime": 90, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g1", "name": "Maris Otter", "unit": "lb", "weight": 16.0, "purpose": "Base", "lovibond": 3.5, "percentage": 64.0}, {"id": "g2", "name": "Roasted Barley", "unit": "lb", "weight": 2.5, "purpose": "Roast / Coffee / Dry Finish", "lovibond": 500, "percentage": 10.0}, {"id": "g3", "name": "Flaked Oats", "unit": "lb", "weight": 2.0, "purpose": "Body / Silkiness", "lovibond": 1.0, "percentage": 8.0}, {"id": "g4", "name": "Chocolate Malt", "unit": "lb", "weight": 1.5, "purpose": "Cocoa / Smooth Roast", "lovibond": 350, "percentage": 6.0}, {"id": "g5", "name": "Crystal 80L", "unit": "lb", "weight": 1.5, "purpose": "Caramel / Residual Sweetness", "lovibond": 80, "percentage": 6.0}, {"id": "g6", "name": "Black Patent", "unit": "lb", "weight": 0.75, "purpose": "Dry Roast Edge", "lovibond": 525, "percentage": 3.0}, {"id": "g7", "name": "CaraMunich II", "unit": "lb", "weight": 0.75, "purpose": "Melanoidin / Depth", "lovibond": 46, "percentage": 3.0}], "efficiency": 72, "hopSchedule": [{"id": "h1", "name": "Magnum", "time": 90, "unit": "oz", "weight": 1.5, "addition": "bittering", "timeUnit": "min", "alphaAcid": 14.0, "ibuContribution": 55}, {"id": "h2", "name": "East Kent Goldings", "time": 15, "unit": "oz", "weight": 0.75, "addition": "flavor", "timeUnit": "min", "alphaAcid": 5.0, "ibuContribution": 10}], "finalGravity": 1.024, "originalGravity": 1.108}	f	\N	2026-03-25 15:07:19.619452+00	2026-03-29 23:53:12.751274+00	\N	3	0
0ccfa3a6-d9ea-49d8-ad0e-b18e45ad4171	0f724598-6082-4b93-b5e4-251a97d2a320	Test Recipe	{"abv": 5.3, "ibu": 35, "srm": 8, "notes": "This is a test note. ", "style": "American Lager", "yeast": {"lab": "Test Yeast", "code": "WLP001", "name": "Test Ale", "notes": "Test Flavor", "style": "", "tempMax": 72, "tempMin": 65, "flavorProfile": [], "attenuationMax": 78, "attenuationMin": 72, "alcoholTolerance": "Medium (9%)", "flocculationLevel": "Medium"}, "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "c940e98e-d938-4f1b-9369-2c987a6e5124", "name": "Test Grain", "unit": "lb", "weight": 8, "purpose": "Bitterness", "lovibond": 2, "percentage": 0}], "difficulty": 3, "efficiency": 75, "hopSchedule": [{"id": "41616c01-f140-414e-b4fa-0a9d3d49a510", "name": "Test Hop", "time": 60, "unit": "oz", "weight": 1, "addition": "bittering", "timeUnit": "min", "alphaAcid": 10, "ibuContribution": 0}], "finalGravity": 1.01, "originalGravity": 1.05, "fermentationSchedule": []}	t	\N	2026-03-26 13:23:13.033762+00	2026-03-29 23:53:12.751274+00	\N	2	0
2158aeee-bcce-4de1-ba9f-9ef4fe2dcc64	a0000000-0000-0000-0000-000000000001	Liberty Vienna (Sam Adams Clone)	{"abv": 5.0, "ibu": 30, "srm": 11, "notes": "// SYSTEM: Complex decoction-style profile. Deep amber hue 11+ SRM.\\n// LOG_REPORT: Munich + Crystal 60 build melanoidin backbone; Hallertau Mittelfrüh for noble aroma stack.\\n// THERMAL_DATA: Hold primary floor ~50–54°F through high krausen.", "style": "Vienna Lager", "yeast": {"lab": "White Labs", "code": "WLP800", "name": "Pilsner Lager Yeast", "notes": "// THERMAL_DATA: Lager schedule ~9–12°C primary, 13–15°C finish window for attenuation polish.", "style": "German Lager", "tempMax": 58, "tempMin": 50, "flavorProfile": ["Toasty Malt", "Noble Hop", "Clean Lager"], "attenuationMax": 79, "attenuationMin": 75, "alcoholTolerance": "Medium-High", "flocculationLevel": "Medium"}, "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g1", "name": "Pilsner Malt", "unit": "lb", "weight": 5.0, "purpose": "Base", "lovibond": 1.6, "percentage": 45.5}, {"id": "g2", "name": "Munich Malt", "unit": "lb", "weight": 4.0, "purpose": "Malt depth / decoction character", "lovibond": 9, "percentage": 36.4}, {"id": "g3", "name": "Crystal 60L", "unit": "lb", "weight": 2.0, "purpose": "Amber / caramel", "lovibond": 60, "percentage": 18.2}], "difficulty": 8, "efficiency": 72, "hopSchedule": [{"id": "h1", "name": "Hallertau Mittelfrüh", "time": 60, "unit": "oz", "weight": 1.0, "addition": "bittering", "timeUnit": "min", "alphaAcid": 4.5, "ibuContribution": 16}, {"id": "h2", "name": "Hallertau Mittelfrüh", "time": 20, "unit": "oz", "weight": 0.75, "addition": "flavor", "timeUnit": "min", "alphaAcid": 4.5, "ibuContribution": 8}, {"id": "h3", "name": "Hallertau Mittelfrüh", "time": 5, "unit": "oz", "weight": 0.5, "addition": "aroma", "timeUnit": "min", "alphaAcid": 4.5, "ibuContribution": 6}], "finalGravity": 1.012, "originalGravity": 1.050, "fermentationSchedule": [{"days": 12, "name": "Primary", "tempMax": 54, "tempMin": 48}, {"days": 3, "name": "Diacetyl rest", "tempMax": 58, "tempMin": 55}, {"days": 21, "name": "Lagering", "tempMax": 40, "tempMin": 34}]}	f	\N	2026-03-29 08:08:21.424186+00	2026-03-29 23:53:12.751274+00	\N	4	0
0ce902e4-4425-4b73-8652-a639a8ddd624	a0000000-0000-0000-0000-000000000011	Open Patio Saison	{"abv": 6.0, "ibu": 28, "srm": 4, "notes": "Farmhouse yeast eats low and dry. Let it free-rise into the 70s after day 2 if your ambient allows. Simple sugar at 10–15 min helps attenuation. Bottle with sturdy carb if you like spritz.", "style": "Saison", "yeast": {"lab": "Wyeast", "code": "3711", "name": "French Saison", "notes": "Not shy about heat; wrap with a heating belt in cool seasons. Expect a long foamy ferment.", "style": "Belgian Ale", "tempMax": 80, "tempMin": 65, "flavorProfile": ["Pepper", "Earthy", "Dry"], "attenuationMax": 88, "attenuationMin": 80, "alcoholTolerance": "High", "flocculationLevel": "Low"}, "boilTime": 90, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g1", "name": "Belgian Pilsner", "unit": "lb", "weight": 8.0, "purpose": "Base", "lovibond": 1.6, "percentage": 80.0}, {"id": "g2", "name": "Wheat Malt", "unit": "lb", "weight": 1.5, "purpose": "Body", "lovibond": 2.5, "percentage": 15.0}, {"id": "g3", "name": "Table Sugar", "unit": "lb", "weight": 0.5, "purpose": "Attenuation aid", "lovibond": 0, "percentage": 5.0}], "difficulty": 6, "efficiency": 72, "hopSchedule": [{"id": "h1", "name": "Styrian Goldings", "time": 60, "unit": "oz", "weight": 1.0, "addition": "bittering", "timeUnit": "min", "alphaAcid": 5.4, "ibuContribution": 18}, {"id": "h2", "name": "Saaz", "time": 10, "unit": "oz", "weight": 1.0, "addition": "aroma", "timeUnit": "min", "alphaAcid": 3.5, "ibuContribution": 10}], "finalGravity": 1.006, "originalGravity": 1.052, "fermentationSchedule": [{"days": 3, "name": "Start steady", "tempMax": 68, "tempMin": 65}, {"days": 7, "name": "Free rise", "notes": "Let yeast drive temperature up", "tempMax": 78, "tempMin": 72}, {"days": 10, "name": "Condition", "tempMax": 70, "tempMin": 68}]}	f	\N	2026-03-28 22:00:01.816423+00	2026-03-29 23:53:12.751274+00	25B	3	0
b39349ed-8e62-4159-a96c-20d10bc28605	a0000000-0000-0000-0000-000000000001	Sol Heritage (Corona Extra Clone)	{"abv": 4.6, "ibu": 13, "srm": 2, "notes": "// SYSTEM: High adjunct ratio requires alpha-amylase stability during mash.\\n// LOG_REPORT: Target 30% flaked maize by extract; hold saccharification rest until iodine-negative before boil.\\n// THERMAL_DATA: Pitch WLP940 sub-55°F (12°C); free-rise only after attenuation >50%.\\nAdjunct-forward pale lager — crisp, minimal malt aroma, dry finish.", "style": "International Pale Lager", "yeast": {"lab": "White Labs", "code": "WLP940", "name": "Mexican Lager Yeast", "notes": "// THERMAL_DATA: Spec window ~9–12°C (48–54°F) primary; allow 13–15°C (55–59°F) only for diacetyl / finish. High adjunct wort — oxygenate well.", "style": "Mexican Lager", "tempMax": 58, "tempMin": 50, "flavorProfile": ["Clean", "Sulfur Acceptable Early", "Crisp", "Dry"], "attenuationMax": 80, "attenuationMin": 75, "alcoholTolerance": "Medium-High", "flocculationLevel": "Medium"}, "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g1", "name": "Pilsner Malt", "unit": "lb", "weight": 7.7, "purpose": "Base", "lovibond": 1.6, "percentage": 70}, {"id": "g2", "name": "Flaked Maize", "unit": "lb", "weight": 3.3, "purpose": "Adjunct / fermentable dilution", "lovibond": 1, "percentage": 30}], "difficulty": 8, "efficiency": 72, "hopSchedule": [{"id": "h1", "name": "Hallertau Mittelfrüh", "time": 60, "unit": "oz", "weight": 0.4, "addition": "bittering", "timeUnit": "min", "alphaAcid": 4.0, "ibuContribution": 7}, {"id": "h2", "name": "Saaz", "time": 15, "unit": "oz", "weight": 0.35, "addition": "flavor", "timeUnit": "min", "alphaAcid": 3.5, "ibuContribution": 4}, {"id": "h3", "name": "Saaz", "time": 5, "unit": "oz", "weight": 0.25, "addition": "aroma", "timeUnit": "min", "alphaAcid": 3.5, "ibuContribution": 2}], "finalGravity": 1.008, "originalGravity": 1.046, "fermentationSchedule": [{"days": 10, "name": "Primary (cool)", "notes": "~9–12°C equivalent", "tempMax": 54, "tempMin": 48}, {"days": 3, "name": "Diacetyl / warm finish", "notes": "~13–15°C band", "tempMax": 59, "tempMin": 55}, {"days": 21, "name": "Lagering", "notes": "Crash after VDK clear", "tempMax": 38, "tempMin": 32}]}	f	\N	2026-03-29 08:08:21.424186+00	2026-03-29 23:53:12.751274+00	\N	4	0
fc21e678-0d46-461b-81a5-d7484ab7222b	a0000000-0000-0000-0000-000000000001	Amsterdam Gold (Heineken Clone)	{"abv": 5.0, "ibu": 19, "srm": 3, "notes": "// SYSTEM: Critical temperature control @ 12°C for peak A-Type crispness.\\n// LOG_REPORT: Danish lager A-yeast profile — super-clean attenuation; minimal ester, tight bubble profile.\\n// THERMAL_DATA: Lock primary at 53.6°F (12°C) ±0.5°C if your rig allows.", "style": "International Pale Lager", "yeast": {"lab": "White Labs", "code": "WLP802", "name": "Danish Lager Yeast", "notes": "// THERMAL_DATA: 12°C (53.6°F) sweet spot for A-type crispness; avoid >14°C until terminal approaches.", "style": "German Lager", "tempMax": 56, "tempMin": 50, "flavorProfile": ["Ultra Clean", "Low Ester", "Snappy Finish"], "attenuationMax": 82, "attenuationMin": 77, "alcoholTolerance": "High", "flocculationLevel": "Medium"}, "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g1", "name": "Pilsner Malt", "unit": "lb", "weight": 9.5, "purpose": "Base", "lovibond": 1.6, "percentage": 95}, {"id": "g2", "name": "Carahell", "unit": "lb", "weight": 0.5, "purpose": "Slight body / foam", "lovibond": 10, "percentage": 5}], "difficulty": 9, "efficiency": 72, "hopSchedule": [{"id": "h1", "name": "Saaz", "time": 60, "unit": "oz", "weight": 0.75, "addition": "bittering", "timeUnit": "min", "alphaAcid": 3.5, "ibuContribution": 10}, {"id": "h2", "name": "Saaz", "time": 20, "unit": "oz", "weight": 0.5, "addition": "flavor", "timeUnit": "min", "alphaAcid": 3.5, "ibuContribution": 5}, {"id": "h3", "name": "Saaz", "time": 5, "unit": "oz", "weight": 0.35, "addition": "aroma", "timeUnit": "min", "alphaAcid": 3.5, "ibuContribution": 4}], "finalGravity": 1.008, "originalGravity": 1.045, "fermentationSchedule": [{"days": 10, "name": "Primary (locked)", "notes": "Hold ~12°C", "tempMax": 55, "tempMin": 52}, {"days": 2, "name": "Diacetyl rest", "tempMax": 58, "tempMin": 55}, {"days": 28, "name": "Lagering", "tempMax": 38, "tempMin": 32}]}	f	\N	2026-03-29 08:08:21.424186+00	2026-03-29 23:53:12.751274+00	\N	5	0
97351113-dc0d-42ce-9296-3434ef0eb9d7	a0000000-0000-0000-0000-000000000001	Leuven Crisp (Stella Artois Clone)	{"abv": 5.2, "ibu": 25, "srm": 3, "notes": "// SYSTEM: Low-ester European profile. Target terminal gravity in 12 days.\\n// LOG_REPORT: Maize adjunct + Saaz saturation; monitor VDK by day 10 before crash.\\n// THERMAL_DATA: Pitch cool; ramp only after gravity within 4 pts of FG target.", "style": "European Pale Lager", "yeast": {"lab": "White Labs", "code": "WLP800", "name": "Pilsner Lager Yeast", "notes": "// THERMAL_DATA: 9–12°C primary band in °F ≈ 48–54; finish 13–15°C (55–59°F) brief for cleanup. 12-day terminal target — verify gravity curve vs twin.", "style": "German Lager", "tempMax": 58, "tempMin": 50, "flavorProfile": ["Herbal Saaz", "Low Ester", "Dry", "Crisp"], "attenuationMax": 80, "attenuationMin": 75, "alcoholTolerance": "Medium-High", "flocculationLevel": "Medium"}, "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g1", "name": "Pilsner Malt", "unit": "lb", "weight": 8.5, "purpose": "Base", "lovibond": 1.6, "percentage": 85}, {"id": "g2", "name": "Flaked Maize", "unit": "lb", "weight": 1.5, "purpose": "Adjunct / crisp mouthfeel", "lovibond": 1, "percentage": 15}], "difficulty": 8, "efficiency": 72, "hopSchedule": [{"id": "h1", "name": "Saaz", "time": 60, "unit": "oz", "weight": 1.0, "addition": "bittering", "timeUnit": "min", "alphaAcid": 3.5, "ibuContribution": 12}, {"id": "h2", "name": "Saaz", "time": 20, "unit": "oz", "weight": 0.75, "addition": "flavor", "timeUnit": "min", "alphaAcid": 3.5, "ibuContribution": 8}, {"id": "h3", "name": "Saaz", "time": 5, "unit": "oz", "weight": 0.75, "addition": "aroma", "timeUnit": "min", "alphaAcid": 3.5, "ibuContribution": 5}], "finalGravity": 1.009, "originalGravity": 1.048, "fermentationSchedule": [{"days": 12, "name": "Primary", "notes": "Terminal gravity target window", "tempMax": 54, "tempMin": 48}, {"days": 3, "name": "Condition", "tempMax": 58, "tempMin": 55}, {"days": 21, "name": "Lagering", "tempMax": 38, "tempMin": 32}]}	f	\N	2026-03-29 08:08:21.424186+00	2026-03-29 23:53:12.751274+00	\N	4	0
58e1b692-2f8f-41a6-94e4-25fb92210d34	a0000000-0000-0000-0000-000000000001	The Ideal Form — Belgian Tripel (Dialectic 01)	{"abv": 9.2, "ibu": 32, "srm": 4, "notes": "// SYSTEM: Abstracted Complexity. This Tripel ignores the material weight of dark grains in favor of pure, high-gravity lucidity. Ferment at 24°C to release the spicy, ethereal esters of the Chico archetype. Clear candi sugar: transformation of substance. Abbey yeast: esters as unseen universals made sensible.", "style": "Belgian Tripel", "yeast": {"lab": "White Labs", "code": "WLP530", "name": "Abbey Ale", "notes": "Belgian abbey profile — spicy, pear, dry. Pitch strong; oxygenate well above 1.075 OG.", "style": "Belgian Ale", "tempMax": 78, "tempMin": 64, "flavorProfile": ["Spicy phenol", "Pear ester", "Dry finish"], "attenuationMax": 82, "attenuationMin": 76, "alcoholTolerance": "Very High", "flocculationLevel": "Medium"}, "boilTime": 90, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g-pils", "name": "Belgian Pilsner Malt", "unit": "lb", "weight": 13.5, "purpose": "Base", "lovibond": 1.6, "percentage": 84}, {"id": "g-candi", "name": "Clear Candi Sugar", "unit": "lb", "weight": 2.75, "purpose": "Sugar / attenuation driver", "lovibond": 0, "percentage": 16}], "difficulty": 9, "efficiency": 70, "hopSchedule": [{"id": "h-sz60", "name": "Saaz", "time": 60, "unit": "oz", "weight": 1.25, "addition": "bittering", "timeUnit": "min", "alphaAcid": 3.5, "ibuContribution": 18}, {"id": "h-sg20", "name": "Styrian Goldings", "time": 20, "unit": "oz", "weight": 0.75, "addition": "flavor", "timeUnit": "min", "alphaAcid": 5.2, "ibuContribution": 9}, {"id": "h-sz5", "name": "Saaz", "time": 5, "unit": "oz", "weight": 0.75, "addition": "aroma", "timeUnit": "min", "alphaAcid": 3.5, "ibuContribution": 5}], "finalGravity": 1.008, "dialecticSeries": "THE_ZYMOLOGICAL_DIALECTIC", "originalGravity": 1.082, "dialecticArchetype": "DIALECTIC_01: THE_IDEAL_FORM", "fermentationSchedule": [{"days": 3, "name": "Establish", "notes": "Pitch cool; let krausen build.", "tempMax": 72, "tempMin": 68}, {"days": 7, "name": "Ester development", "notes": "Hold near 24°C for ethereal ester phase.", "tempMax": 76, "tempMin": 73}, {"days": 14, "name": "Attenuation polish", "notes": "VDK cleanup; tripels reward patience.", "tempMax": 74, "tempMin": 70}]}	f	\N	2026-03-29 09:51:19.226991+00	2026-03-29 23:53:12.751274+00	\N	5	0
a6da618e-d859-48de-acbe-4996955ab972	a0000000-0000-0000-0000-000000000010	First Flight SMaSH Pale	{"abv": 5.2, "ibu": 35, "srm": 5, "notes": "Single malt, single hop: the cleanest way to learn your system. Mash at 152°F, watch pH, and take good notes. Cascade is forgiving and classic. If efficiency is low, your gravity will be lower and that is fine for a first brew.", "style": "American Pale Ale", "yeast": {"lab": "SafAle", "code": "US-05", "name": "American Ale Yeast Blend", "notes": "US-05 is forgiving for a first brew: no starter required. Hold 65–68°F for a clean pale ale profile.", "style": "American Ale", "tempMax": 72, "tempMin": 59, "flavorProfile": ["Neutral", "Clean", "Slight Fruit"], "attenuationMax": 82, "attenuationMin": 78, "alcoholTolerance": "High", "flocculationLevel": "Medium"}, "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g1", "name": "Maris Otter", "unit": "lb", "weight": 9.5, "purpose": "Base (SMaSH)", "lovibond": 3, "percentage": 100}], "difficulty": 2, "efficiency": 72, "hopSchedule": [{"id": "h1", "name": "Cascade", "time": 60, "unit": "oz", "weight": 0.75, "addition": "bittering", "timeUnit": "min", "alphaAcid": 5.5, "ibuContribution": 22}, {"id": "h2", "name": "Cascade", "time": 15, "unit": "oz", "weight": 0.5, "addition": "flavor", "timeUnit": "min", "alphaAcid": 5.5, "ibuContribution": 8}, {"id": "h3", "name": "Cascade", "time": 5, "unit": "oz", "weight": 1.0, "addition": "aroma", "timeUnit": "min", "alphaAcid": 5.5, "ibuContribution": 5}], "finalGravity": 1.010, "originalGravity": 1.050}	f	\N	2026-03-28 22:00:01.816423+00	2026-03-29 23:53:12.751274+00	18B	1	0
43950219-cb0e-44d9-969c-51938ebf0cdc	0f724598-6082-4b93-b5e4-251a97d2a320	Sierra Heritage Pale	{"abv": 5.6, "ibu": 38, "srm": 9, "notes": "The definitive American Pale Ale homage: crisp, floral, balanced, with an amber hue and grapefruit–pine aromatics. Mash: single infusion 67°C (152°F) for 60 minutes. Whirlpool the late Cascade addition off the boil. Optional: dry-hop around day 7 of fermentation with an extra 28 g Cascade if you want more aroma (not in the original spec sheet).", "style": "American Pale Ale", "yeast": {"lab": "White Labs", "code": "WLP001", "name": "California Ale", "notes": "Chico-type clean ale yeast. Ferment near 20°C (68°F) for balance; free-rise a degree or two late fermentation if gravity stalls.", "style": "American Ale", "tempMax": 72, "tempMin": 64, "flavorProfile": ["Clean", "Neutral", "Crisp"], "attenuationMax": 80, "attenuationMin": 73, "alcoholTolerance": "Medium-High", "flocculationLevel": "Medium"}, "boilTime": 60, "batchSize": 19, "batchUnit": "L", "grainBill": [{"id": "g1", "name": "American 2-Row", "unit": "kg", "weight": 4.75, "purpose": "Base", "lovibond": 1.8, "percentage": 92}, {"id": "g2", "name": "Crystal 60L", "unit": "kg", "weight": 0.4, "purpose": "Color / Caramel", "lovibond": 60, "percentage": 8}], "difficulty": 5, "efficiency": 72, "hopSchedule": [{"id": "h1", "name": "Magnum", "time": 60, "unit": "g", "weight": 14, "addition": "bittering", "timeUnit": "min", "alphaAcid": 12.0, "ibuContribution": 18}, {"id": "h2", "name": "Perle", "time": 30, "unit": "g", "weight": 14, "addition": "flavor", "timeUnit": "min", "alphaAcid": 8.0, "ibuContribution": 10}, {"id": "h3", "name": "Cascade", "time": 10, "unit": "g", "weight": 28, "addition": "aroma", "timeUnit": "min", "alphaAcid": 5.5, "ibuContribution": 7}, {"id": "h4", "name": "Cascade", "time": 0, "unit": "g", "weight": 56, "addition": "aroma", "timeUnit": "flameout", "alphaAcid": 5.5, "ibuContribution": 3}], "finalGravity": 1.011, "originalGravity": 1.053, "fermentationSchedule": [{"days": 14, "name": "Primary", "notes": "Target ~20°C (68°F). Optional Cascade dry hop around day 7.", "tempMax": 70, "tempMin": 66}]}	f	\N	2026-03-28 22:11:37.159682+00	2026-03-29 23:53:12.751274+00	18B	3	0
bdbdf241-3f69-4377-a01f-7424f8538879	a0000000-0000-0000-0000-000000000010	Honey Blonde Ale	{"abv": 4.9, "ibu": 20, "srm": 4, "notes": "Add honey at flameout so aromatics survive. Ferment cool for a crisp blonde; the honey lightens body without making it mead-like. Great second brew after a SMaSH.", "style": "Blonde Ale", "yeast": {"lab": "White Labs", "code": "WLP001", "name": "California Ale", "notes": "Pitch at 65°F. Optional: add 8–12 oz wildflower honey at flameout (stir in off heat) for extra aroma.", "style": "American Ale", "tempMax": 68, "tempMin": 65, "flavorProfile": ["Clean", "Mild Fruit"], "attenuationMax": 80, "attenuationMin": 73, "alcoholTolerance": "Very High", "flocculationLevel": "Medium"}, "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g1", "name": "American 2-Row", "unit": "lb", "weight": 8.5, "purpose": "Base", "lovibond": 1.8, "percentage": 89.5}, {"id": "g2", "name": "Carahell", "unit": "lb", "weight": 1.0, "purpose": "Body / Gold color", "lovibond": 10, "percentage": 10.5}], "difficulty": 2, "efficiency": 72, "hopSchedule": [{"id": "h1", "name": "Willamette", "time": 60, "unit": "oz", "weight": 0.5, "addition": "bittering", "timeUnit": "min", "alphaAcid": 5.0, "ibuContribution": 12}, {"id": "h2", "name": "Willamette", "time": 10, "unit": "oz", "weight": 0.5, "addition": "aroma", "timeUnit": "min", "alphaAcid": 5.0, "ibuContribution": 8}], "finalGravity": 1.008, "originalGravity": 1.046}	f	\N	2026-03-28 22:00:01.816423+00	2026-03-29 23:53:12.751274+00	18A	1	0
1475afaf-a240-498a-b1f0-1d5c1592adac	a0000000-0000-0000-0000-000000000010	Brown Bag Nut Brown	{"abv": 4.7, "ibu": 22, "srm": 18, "notes": "Malt-forward and sessionable. Keep roast low; brown malt and crystal build the nutty character. A good intro to darker grains without harsh acrid notes.", "style": "English Brown Ale", "yeast": {"lab": "Wyeast", "code": "1318", "name": "London Ale III", "notes": "Leaves a slight roundness that suits brown ales. Allow full attenuation before packaging.", "style": "British Ale", "tempMax": 70, "tempMin": 64, "flavorProfile": ["Mild Fruit", "Malt Support"], "attenuationMax": 75, "attenuationMin": 71, "alcoholTolerance": "Medium", "flocculationLevel": "High"}, "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g1", "name": "Maris Otter", "unit": "lb", "weight": 7.5, "purpose": "Base", "lovibond": 3, "percentage": 78.9}, {"id": "g2", "name": "Brown Malt", "unit": "lb", "weight": 0.75, "purpose": "Nut / Toast", "lovibond": 65, "percentage": 7.9}, {"id": "g3", "name": "Crystal 60L", "unit": "lb", "weight": 0.75, "purpose": "Caramel", "lovibond": 60, "percentage": 7.9}, {"id": "g4", "name": "Chocolate Malt", "unit": "lb", "weight": 0.25, "purpose": "Color (light hand)", "lovibond": 350, "percentage": 2.6}], "difficulty": 3, "efficiency": 72, "hopSchedule": [{"id": "h1", "name": "East Kent Goldings", "time": 60, "unit": "oz", "weight": 0.75, "addition": "bittering", "timeUnit": "min", "alphaAcid": 5.0, "ibuContribution": 14}, {"id": "h2", "name": "Fuggles", "time": 15, "unit": "oz", "weight": 0.5, "addition": "flavor", "timeUnit": "min", "alphaAcid": 4.5, "ibuContribution": 8}], "finalGravity": 1.012, "originalGravity": 1.048}	f	\N	2026-03-28 22:00:01.816423+00	2026-03-29 23:53:12.751274+00	13C	2	0
fe3a38b0-796e-4387-81f8-97912e4b4521	a0000000-0000-0000-0000-000000000011	Proper Best Bitter	{"abv": 3.9, "ibu": 32, "srm": 12, "notes": "A cask-friendly gravity with firm hop presence. Target sulfate-forward water if you can. Let it condition; bitters reward patience over cold crashing alone.", "style": "Best Bitter", "yeast": {"lab": "Wyeast", "code": "1968", "name": "London ESB Ale", "notes": "Classic ESB character with slight diacetyl acceptable at low levels; keep fermentation steady.", "style": "British Ale", "tempMax": 68, "tempMin": 64, "flavorProfile": ["Stone Fruit", "Malt", "Low Diacetyl OK"], "attenuationMax": 71, "attenuationMin": 67, "alcoholTolerance": "Medium", "flocculationLevel": "Very High"}, "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g1", "name": "Maris Otter", "unit": "lb", "weight": 7.5, "purpose": "Base", "lovibond": 3, "percentage": 83.3}, {"id": "g2", "name": "Crystal 55L", "unit": "lb", "weight": 0.75, "purpose": "Caramel", "lovibond": 55, "percentage": 8.3}, {"id": "g3", "name": "Torrefied Wheat", "unit": "lb", "weight": 0.75, "purpose": "Head / Body", "lovibond": 2, "percentage": 8.3}], "difficulty": 5, "efficiency": 75, "hopSchedule": [{"id": "h1", "name": "Target", "time": 60, "unit": "oz", "weight": 0.75, "addition": "bittering", "timeUnit": "min", "alphaAcid": 10.5, "ibuContribution": 24}, {"id": "h2", "name": "East Kent Goldings", "time": 15, "unit": "oz", "weight": 0.75, "addition": "flavor", "timeUnit": "min", "alphaAcid": 5.0, "ibuContribution": 8}], "finalGravity": 1.010, "originalGravity": 1.040}	f	\N	2026-03-28 22:00:01.816423+00	2026-03-29 23:53:12.751274+00	11B	3	0
93a24461-8be0-4c44-b648-30064c143142	a0000000-0000-0000-0000-000000000001	The Grounded Mean — Traditional ESB (Dialectic 02)	{"abv": 5.3, "ibu": 38, "srm": 13, "notes": "// SYSTEM: Material Observation. A recipe focused on the substance of the grain and the bitterness of the hop. Balanced, reliable, and perfectly aligned with the Earth's 'Mean'. Observe strictly the 66°C mash for fermentability. Water: calcium carbonate (chalk) in the mash honors mineral materiality on soft or RO water — roots the hop in the glass.", "style": "Extra Special Bitter (ESB)", "yeast": {"lab": "White Labs", "code": "WLP002", "name": "English Ale", "notes": "Classic London profile — malt-forward, light fruit, clean diacetyl window if rushed. Ferment mid-60s °F.", "style": "British Ale", "tempMax": 68, "tempMin": 63, "flavorProfile": ["Malt", "Light stone fruit", "Low ester"], "attenuationMax": 70, "attenuationMin": 63, "alcoholTolerance": "Medium", "flocculationLevel": "Very High"}, "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g-mo", "name": "Floor-Malted Maris Otter", "unit": "lb", "weight": 10.5, "purpose": "Base", "lovibond": 3.5, "percentage": 84}, {"id": "g-c45", "name": "Crystal 45L", "unit": "lb", "weight": 1.25, "purpose": "Caramel / copper", "lovibond": 45, "percentage": 10}, {"id": "g-bis", "name": "Biscuit Malt", "unit": "lb", "weight": 0.75, "purpose": "Toast / depth", "lovibond": 23, "percentage": 6}], "difficulty": 5, "efficiency": 73, "hopSchedule": [{"id": "h-ekg60", "name": "East Kent Goldings", "time": 60, "unit": "oz", "weight": 1.25, "addition": "bittering", "timeUnit": "min", "alphaAcid": 5.0, "ibuContribution": 22}, {"id": "h-ekg25", "name": "East Kent Goldings", "time": 25, "unit": "oz", "weight": 0.75, "addition": "flavor", "timeUnit": "min", "alphaAcid": 5.0, "ibuContribution": 10}, {"id": "h-ekg5", "name": "East Kent Goldings", "time": 5, "unit": "oz", "weight": 0.5, "addition": "aroma", "timeUnit": "min", "alphaAcid": 5.0, "ibuContribution": 6}], "finalGravity": 1.014, "dialecticSeries": "THE_ZYMOLOGICAL_DIALECTIC", "originalGravity": 1.054, "dialecticArchetype": "DIALECTIC_02: THE_GROUNDED_MEAN", "fermentationSchedule": [{"days": 7, "name": "Primary", "notes": "Stable cellar temperatures; ESB rewards patience over warmth.", "tempMax": 66, "tempMin": 63}, {"days": 7, "name": "Condition", "notes": "Allow malt-hop integration to settle.", "tempMax": 64, "tempMin": 60}]}	f	\N	2026-03-29 09:51:19.226991+00	2026-03-29 23:53:12.751274+00	11B	3	0
b314edd0-2150-4d72-b37a-a8caebaeea84	a0000000-0000-0000-0000-000000000011	Library Dry Stout	{"abv": 4.2, "ibu": 38, "srm": 38, "notes": "Roasted barley drives the classic coffee note; keep boil pH in mind with dark malts. Nitro optional in the glass, not in the fermenter.", "style": "Dry Stout", "yeast": {"lab": "Wyeast", "code": "1084", "name": "Irish Ale", "notes": "Cool fermentation keeps esters low; let it finish fully for a dry pint.", "style": "British Ale", "tempMax": 66, "tempMin": 62, "flavorProfile": ["Clean", "Roast Support"], "attenuationMax": 75, "attenuationMin": 71, "alcoholTolerance": "Medium", "flocculationLevel": "Medium"}, "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g1", "name": "Maris Otter", "unit": "lb", "weight": 6.5, "purpose": "Base", "lovibond": 3, "percentage": 72.2}, {"id": "g2", "name": "Flaked Barley", "unit": "lb", "weight": 1.0, "purpose": "Creamy head", "lovibond": 2, "percentage": 11.1}, {"id": "g3", "name": "Roasted Barley", "unit": "lb", "weight": 0.75, "purpose": "Roast / Coffee", "lovibond": 300, "percentage": 8.3}, {"id": "g4", "name": "Black Patent", "unit": "lb", "weight": 0.5, "purpose": "Color", "lovibond": 500, "percentage": 5.6}], "difficulty": 5, "efficiency": 72, "hopSchedule": [{"id": "h1", "name": "Magnum", "time": 60, "unit": "oz", "weight": 0.75, "addition": "bittering", "timeUnit": "min", "alphaAcid": 12.0, "ibuContribution": 32}, {"id": "h2", "name": "Fuggles", "time": 15, "unit": "oz", "weight": 0.5, "addition": "flavor", "timeUnit": "min", "alphaAcid": 4.5, "ibuContribution": 6}], "finalGravity": 1.010, "originalGravity": 1.042}	f	\N	2026-03-28 22:00:01.816423+00	2026-03-29 23:53:12.751274+00	15B	3	0
c7c0e650-f03a-467a-ae0a-3ba7e259af3a	a0000000-0000-0000-0000-000000000011	Autumn Märzen	{"abv": 5.8, "ibu": 24, "srm": 11, "notes": "Traditional lager workflow: pitch cold, diacetyl rest, long lagering. Single decoction is classic; double infusion at 145°F then 158°F is a practical compromise. Plan 6–8 weeks before tapping.", "style": "Märzen", "yeast": {"lab": "Wyeast", "code": "2633", "name": "Oktoberfest Lager Blend", "notes": "Pitch large; follow temperature schedule in fermentationSchedule. Patience equals clarity.", "style": "German Lager", "tempMax": 58, "tempMin": 48, "flavorProfile": ["Clean Malt", "Low Ester", "Smooth"], "attenuationMax": 77, "attenuationMin": 73, "alcoholTolerance": "High", "flocculationLevel": "Medium"}, "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g1", "name": "Munich Malt", "unit": "lb", "weight": 7.0, "purpose": "Base / Malt", "lovibond": 6, "percentage": 63.6}, {"id": "g2", "name": "Vienna Malt", "unit": "lb", "weight": 3.0, "purpose": "Malt depth", "lovibond": 3.5, "percentage": 27.3}, {"id": "g3", "name": "Pilsner Malt", "unit": "lb", "weight": 1.0, "purpose": "Lighten", "lovibond": 1.6, "percentage": 9.1}], "difficulty": 7, "efficiency": 72, "hopSchedule": [{"id": "h1", "name": "Hallertau Mittelfrüh", "time": 60, "unit": "oz", "weight": 1.25, "addition": "bittering", "timeUnit": "min", "alphaAcid": 4.5, "ibuContribution": 18}, {"id": "h2", "name": "Tettnang", "time": 15, "unit": "oz", "weight": 0.5, "addition": "flavor", "timeUnit": "min", "alphaAcid": 4.0, "ibuContribution": 6}], "finalGravity": 1.012, "originalGravity": 1.056, "fermentationSchedule": [{"days": 10, "name": "Primary (cool)", "notes": "Pitch at 48–50°F if possible", "tempMax": 52, "tempMin": 50}, {"days": 3, "name": "Diacetyl rest", "tempMax": 58, "tempMin": 55}, {"days": 35, "name": "Lagering", "notes": "Longer is traditional", "tempMax": 38, "tempMin": 32}]}	f	\N	2026-03-28 22:00:01.816423+00	2026-03-29 23:53:12.751274+00	6A	4	0
685f551a-f041-4cc0-ba50-d6409daa4e6e	a0000000-0000-0000-0000-000000000002	American Amber Ale	{"abv": 5.5, "ibu": 34, "srm": 14, "notes": "A well-balanced American amber that hits every note. The Special B adds a subtle dark-fruit complexity that keeps it interesting without dominating. Centennial provides clean bitterness, Chinook adds a touch of pine, and the late Cascade addition gives brightness. This is a crowd-pleaser that experienced brewers appreciate too — great year-round brew.", "style": "American Amber Ale", "yeast": {"lab": "White Labs", "code": "WLP001", "name": "California Ale", "notes": "A clean fermenter that keeps the malt and hop character front and center. Slightly higher fermentation temperature (67°F) brings out a touch of fruitiness that complements the caramel malts.", "style": "American Ale", "tempMax": 68, "tempMin": 65, "flavorProfile": ["Clean", "Neutral", "Slight Ester at Warm Temps"], "attenuationMax": 80, "attenuationMin": 73, "alcoholTolerance": "Very High", "flocculationLevel": "Medium"}, "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g1", "name": "Pale 2-Row (US)", "unit": "lb", "weight": 8.5, "purpose": "Base", "lovibond": 1.8, "percentage": 73.9}, {"id": "g2", "name": "Crystal 60L", "unit": "lb", "weight": 1.5, "purpose": "Caramel / Body", "lovibond": 60, "percentage": 13.0}, {"id": "g3", "name": "Vienna Malt", "unit": "lb", "weight": 1.0, "purpose": "Malt Character", "lovibond": 3.5, "percentage": 8.7}, {"id": "g4", "name": "Special B", "unit": "lb", "weight": 0.5, "purpose": "Dark Fruit / Color Depth", "lovibond": 180, "percentage": 4.3}], "efficiency": 74, "hopSchedule": [{"id": "h1", "name": "Centennial", "time": 60, "unit": "oz", "weight": 0.75, "addition": "bittering", "timeUnit": "min", "alphaAcid": 10.0, "ibuContribution": 22}, {"id": "h2", "name": "Chinook", "time": 15, "unit": "oz", "weight": 0.5, "addition": "flavor", "timeUnit": "min", "alphaAcid": 13.0, "ibuContribution": 9}, {"id": "h3", "name": "Cascade", "time": 5, "unit": "oz", "weight": 0.75, "addition": "aroma", "timeUnit": "min", "alphaAcid": 5.5, "ibuContribution": 3}, {"id": "h4", "name": "Cascade", "time": 3, "unit": "oz", "weight": 1.5, "addition": "dry hop", "timeUnit": "days", "alphaAcid": 5.5, "ibuContribution": 0}], "finalGravity": 1.013, "originalGravity": 1.057}	f	\N	2026-03-25 15:07:19.619452+00	2026-03-29 23:53:12.751274+00	19A	3	0
f6e5f2c4-d4e1-4469-bbc9-57558fbffd11	a0000000-0000-0000-0000-000000000002	Copper Tun Amber (template)	{"abv": 5.2, "ibu": 32, "srm": 15, "notes": "Balanced amber for club brews and split batches. Crystal builds color and sweetness; Columbus keeps the finish from cloying. Fork and swap hops for your house character.", "style": "American Amber Ale", "yeast": {"lab": "White Labs", "code": "WLP001", "name": "California Ale", "notes": "Straightforward Chico profile; ferment at 66°F for balance.", "style": "American Ale", "tempMax": 68, "tempMin": 65, "flavorProfile": ["Clean", "Citrus Support"], "attenuationMax": 80, "attenuationMin": 73, "alcoholTolerance": "Very High", "flocculationLevel": "Medium"}, "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g1", "name": "Pale 2-Row (US)", "unit": "lb", "weight": 8.0, "purpose": "Base", "lovibond": 1.8, "percentage": 80.0}, {"id": "g2", "name": "Crystal 40L", "unit": "lb", "weight": 1.25, "purpose": "Caramel / Color", "lovibond": 40, "percentage": 12.5}, {"id": "g3", "name": "Victory Malt", "unit": "lb", "weight": 0.75, "purpose": "Toast", "lovibond": 28, "percentage": 7.5}], "difficulty": 4, "efficiency": 74, "hopSchedule": [{"id": "h1", "name": "Columbus", "time": 60, "unit": "oz", "weight": 0.5, "addition": "bittering", "timeUnit": "min", "alphaAcid": 15.0, "ibuContribution": 24}, {"id": "h2", "name": "Cascade", "time": 10, "unit": "oz", "weight": 0.75, "addition": "flavor", "timeUnit": "min", "alphaAcid": 5.5, "ibuContribution": 8}], "finalGravity": 1.012, "originalGravity": 1.052}	f	\N	2026-03-28 22:00:01.816423+00	2026-03-29 23:53:12.751274+00	19A	2	0
641c7e4b-8406-48b7-97f1-968e5c739bfb	0f724598-6082-4b93-b5e4-251a97d2a320	YeastCoast IPA	{"abv": 7.2, "ibu": 68, "srm": 6, "notes": "The YeastCoast Flagship. A nod to the resinous, high-altitude IPAs of the Rockies. Resinous pine, sharp citrus, and a bone-dry finish. No juice, no haze—just clear, bitter perfection.", "style": "American IPA", "yeast": {"lab": "White Labs", "code": "WLP001", "name": "California Ale", "notes": "The industry standard for West Coast-style ales. Ultra-clean, crisp, and highly attenuative — lets the hop character lead without yeast interference.", "style": "American Ale Yeast", "tempMax": 68, "tempMin": 65, "flavorProfile": ["Clean", "Neutral", "Slight Biscuit", "Crisp Finish"], "attenuationMax": 80, "attenuationMin": 73, "alcoholTolerance": "Medium-High (10%)", "flocculationLevel": "Medium"}, "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g1", "name": "North American 2-Row", "unit": "lb", "weight": 11.25, "purpose": "Base Malt", "lovibond": 1.8, "percentage": 85.0}, {"id": "g2", "name": "Munich II", "unit": "lb", "weight": 1.25, "purpose": "Character / Elevation Spine", "lovibond": 8.5, "percentage": 9.4}, {"id": "g3", "name": "Carapils (Dextrin)", "unit": "lb", "weight": 0.75, "purpose": "Head Retention", "lovibond": 1.3, "percentage": 5.6}], "difficulty": 6, "efficiency": 75, "hopSchedule": [{"id": "h1", "name": "Chinook", "time": 60, "unit": "oz", "weight": 1.0, "addition": "bittering", "timeUnit": "min", "alphaAcid": 13.0, "ibuContribution": 40}, {"id": "h2", "name": "Simcoe", "time": 10, "unit": "oz", "weight": 0.75, "addition": "flavor", "timeUnit": "min", "alphaAcid": 13.0, "ibuContribution": 14}, {"id": "h3", "name": "Centennial", "time": 10, "unit": "oz", "weight": 0.5, "addition": "flavor", "timeUnit": "min", "alphaAcid": 10.5, "ibuContribution": 8}, {"id": "h4", "name": "Mosaic", "time": 0, "unit": "oz", "weight": 1.0, "addition": "aroma", "timeUnit": "flameout", "alphaAcid": 12.5, "ibuContribution": 4}, {"id": "h5", "name": "Amarillo", "time": 0, "unit": "oz", "weight": 0.75, "addition": "aroma", "timeUnit": "flameout", "alphaAcid": 9.0, "ibuContribution": 2}, {"id": "h6", "name": "Simcoe", "time": 3, "unit": "oz", "weight": 1.5, "addition": "dry hop", "timeUnit": "dry hop", "alphaAcid": 13.0, "ibuContribution": 0}, {"id": "h7", "name": "Centennial", "time": 3, "unit": "oz", "weight": 1.0, "addition": "dry hop", "timeUnit": "dry hop", "alphaAcid": 10.5, "ibuContribution": 0}], "finalGravity": 1.011, "originalGravity": 1.066}	f	\N	2026-03-25 23:56:22.935813+00	2026-03-29 23:53:12.751274+00	21A	3	0
83414187-60ee-47aa-87ee-6076521c264a	a0000000-0000-0000-0000-000000000001	Bremen Pils (Beck's Clone)	{"abv": 5.0, "ibu": 30, "srm": 3, "notes": "// SYSTEM: Distinctive Noble hop profile. High sulfur potential during lag Phase 1.\\n// LOG_REPORT: 100% Pilsner grist — single decoction optional for authenticity; sulfate-forward water accentuates hop snap.\\n// THERMAL_DATA: Expect DMS vigilance on short-boil variants; 90 min boil traditional.", "style": "German Pilsner", "yeast": {"lab": "White Labs", "code": "WLP830", "name": "German Lager Yeast", "notes": "// THERMAL_DATA: Pitch 48–52°F (9–11°C); sulfur normal early — vent fermenter. Diacetyl rest 55–58°F before crash.", "style": "German Lager", "tempMax": 58, "tempMin": 50, "flavorProfile": ["Sulfur (fades)", "Floral Hop", "Clean Malt", "Bitter Finish"], "attenuationMax": 80, "attenuationMin": 76, "alcoholTolerance": "High", "flocculationLevel": "Medium"}, "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g1", "name": "German Pilsner Malt", "unit": "lb", "weight": 10.5, "purpose": "Base (single malt)", "lovibond": 1.6, "percentage": 100}], "difficulty": 8, "efficiency": 72, "hopSchedule": [{"id": "h1", "name": "Hallertau Mittelfrüh", "time": 60, "unit": "oz", "weight": 1.25, "addition": "bittering", "timeUnit": "min", "alphaAcid": 4.5, "ibuContribution": 18}, {"id": "h2", "name": "Tettnang", "time": 20, "unit": "oz", "weight": 0.75, "addition": "flavor", "timeUnit": "min", "alphaAcid": 4.0, "ibuContribution": 8}, {"id": "h3", "name": "Hallertau Mittelfrüh", "time": 5, "unit": "oz", "weight": 0.5, "addition": "aroma", "timeUnit": "min", "alphaAcid": 4.5, "ibuContribution": 4}], "finalGravity": 1.010, "originalGravity": 1.048, "fermentationSchedule": [{"days": 4, "name": "Lag Phase 1 (sulfur)", "notes": "High sulfur potential — do not panic", "tempMax": 52, "tempMin": 48}, {"days": 8, "name": "Primary", "notes": "~9–12°C core", "tempMax": 54, "tempMin": 50}, {"days": 3, "name": "Diacetyl rest", "tempMax": 58, "tempMin": 55}, {"days": 28, "name": "Lagering", "tempMax": 38, "tempMin": 32}]}	f	\N	2026-03-29 08:08:21.424186+00	2026-03-29 23:53:12.751274+00	5D	4	0
caf2196f-f718-4bd7-a65a-0edceee729a6	a0000000-0000-0000-0000-000000000002	Olde Eight-Ball (Olde English 800 Clone)	{"abv": 8.0, "ibu": 12, "srm": 3, "notes": "// FIELD_NOTES: The OG. The one that started it all. This is a high-adjunct lager, so a strong yeast starter is your best friend. Ferment cold and clean to achieve that deceptively smooth character. Pairs well with late-night convenience store runs and questionable life choices. Remember to pour one out for the homies.", "style": "American Malt Liquor", "yeast": {"lab": "White Labs", "code": "WLP840", "name": "American Lager Yeast", "notes": "High-adjunct wort — oxygenate well; pitch a generous starter. Hold primary at the low end of the range for a clean profile; brief diacetyl rest before crash.", "style": "American Lager", "tempMax": 55, "tempMin": 48, "flavorProfile": ["Clean", "Neutral", "Slight Sulfur Early"], "attenuationMax": 76, "attenuationMin": 72, "alcoholTolerance": "High", "flocculationLevel": "Medium"}, "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g1", "name": "6-Row Malt", "unit": "lb", "weight": 6.5, "purpose": "Base / diastatic power", "lovibond": 1.8, "percentage": 53.1}, {"id": "g2", "name": "Flaked Corn", "unit": "lb", "weight": 4.5, "purpose": "Adjunct / smooth fermentable body", "lovibond": 1, "percentage": 36.7}, {"id": "g3", "name": "Dextrose", "unit": "lb", "weight": 1.25, "purpose": "Adjunct / ABV boost (kettle)", "lovibond": 0, "percentage": 10.2}], "difficulty": 7, "efficiency": 72, "hopSchedule": [{"id": "h1", "name": "Cluster", "time": 60, "unit": "oz", "weight": 0.5, "addition": "bittering", "timeUnit": "min", "alphaAcid": 6.0, "ibuContribution": 12}], "finalGravity": 1.010, "originalGravity": 1.065, "fermentationSchedule": [{"days": 12, "name": "Primary (cold)", "notes": "Keep fermentation cool and steady", "tempMax": 52, "tempMin": 48}, {"days": 3, "name": "Diacetyl rest", "notes": "Raise only after attenuation mostly complete", "tempMax": 58, "tempMin": 55}, {"days": 21, "name": "Lagering", "notes": "Crash after VDK clear", "tempMax": 38, "tempMin": 32}]}	f	\N	2026-04-05 21:41:24.14615+00	2026-04-05 21:41:24.14615+00	\N	3	0
4050145b-dcca-4893-ab81-522ae34fc3f1	a0000000-0000-0000-0000-000000000002	Green Grenade (Mickey's Fine Malt Liquor Clone)	{"abv": 5.6, "ibu": 15, "srm": 3, "notes": "// FIELD_NOTES: The key to the Green Grenade is its surprising crispness, achieved with a hefty dose of rice adjuncts. Best enjoyed ice-cold while trying to solve the riddle under the cap. If you bottle this, for the love of all that is holy, use green bottles for authenticity. Warning: May induce spontaneous acts of friendship and/or minor property damage.", "style": "American Malt Liquor", "yeast": {"lab": "White Labs", "code": "WLP840", "name": "American Lager Yeast", "notes": "Rice-heavy mash — watch pH; rice hulls if needed. Ferment cool for snappy malt-liquor drinkability.", "style": "American Lager", "tempMax": 55, "tempMin": 48, "flavorProfile": ["Clean", "Dry", "Neutral"], "attenuationMax": 76, "attenuationMin": 72, "alcoholTolerance": "High", "flocculationLevel": "Medium"}, "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g1", "name": "6-Row Malt", "unit": "lb", "weight": 7.0, "purpose": "Base / diastatic power", "lovibond": 1.8, "percentage": 63.6}, {"id": "g2", "name": "Flaked Rice", "unit": "lb", "weight": 3.5, "purpose": "Adjunct / crisp dry finish", "lovibond": 1, "percentage": 31.8}, {"id": "g3", "name": "Dextrose", "unit": "lb", "weight": 0.5, "purpose": "Adjunct / ABV boost (kettle)", "lovibond": 0, "percentage": 4.5}], "difficulty": 7, "efficiency": 72, "hopSchedule": [{"id": "h1", "name": "Cluster", "time": 60, "unit": "oz", "weight": 0.65, "addition": "bittering", "timeUnit": "min", "alphaAcid": 6.0, "ibuContribution": 15}], "finalGravity": 1.008, "originalGravity": 1.055, "fermentationSchedule": [{"days": 10, "name": "Primary (cold)", "notes": "Crispness lives here", "tempMax": 52, "tempMin": 48}, {"days": 3, "name": "Diacetyl rest", "notes": "Short warm finish", "tempMax": 58, "tempMin": 55}, {"days": 14, "name": "Lagering", "notes": "Optional polish for packaged clarity", "tempMax": 38, "tempMin": 32}]}	f	\N	2026-04-05 21:41:24.14615+00	2026-04-05 21:41:24.14615+00	\N	3	0
0ce20da2-4221-4e58-8d70-753ff6a2eec2	a0000000-0000-0000-0000-000000000002	High Gravity Protocol (Steel Reserve 211 Clone)	{"abv": 8.1, "ibu": 10, "srm": 4, "notes": "// FIELD_NOTES: The 211. A high-gravity lager that sacrifices subtlety for sheer, unadulterated power. The secret is a massive grain bill with an absurd amount of dextrose to push the ABV into the stratosphere. Ferment as cold as your system will allow to keep the 'jet fuel' notes at a dull roar. This isn't a beer for tasting; it's a beer for accomplishing missions. Handle with care.", "style": "American Malt Liquor", "yeast": {"lab": "White Labs", "code": "WLP840", "name": "American Lager Yeast", "notes": "Very high gravity — stepped nutrients and strong pitch strongly recommended. Keep temperature pinned low through peak fermentation.", "style": "American Lager", "tempMax": 55, "tempMin": 48, "flavorProfile": ["Clean", "Alcohol Warmth", "Minimal Hop"], "attenuationMax": 76, "attenuationMin": 72, "alcoholTolerance": "High", "flocculationLevel": "Medium"}, "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g1", "name": "6-Row Malt", "unit": "lb", "weight": 6.75, "purpose": "Base / diastatic power", "lovibond": 1.8, "percentage": 52.9}, {"id": "g2", "name": "Flaked Corn", "unit": "lb", "weight": 3.25, "purpose": "Adjunct / fermentable body", "lovibond": 1, "percentage": 25.5}, {"id": "g3", "name": "Dextrose", "unit": "lb", "weight": 2.75, "purpose": "Adjunct / ABV boost (kettle)", "lovibond": 0, "percentage": 21.6}], "difficulty": 8, "efficiency": 72, "hopSchedule": [{"id": "h1", "name": "Cluster", "time": 60, "unit": "oz", "weight": 0.4, "addition": "bittering", "timeUnit": "min", "alphaAcid": 6.0, "ibuContribution": 10}], "finalGravity": 1.009, "originalGravity": 1.072, "fermentationSchedule": [{"days": 14, "name": "Primary (cold)", "notes": "Coldest stable point your gear allows", "tempMax": 50, "tempMin": 48}, {"days": 4, "name": "Warm finish", "notes": "Ease up only if attenuation stalls", "tempMax": 55, "tempMin": 52}, {"days": 28, "name": "Lagering", "notes": "Long crash helps round harsh edges", "tempMax": 38, "tempMin": 32}]}	f	\N	2026-04-05 21:41:24.14615+00	2026-04-05 21:41:24.14615+00	\N	3	0
2ec780f0-0969-4c58-a5e4-0ef807ded79f	user_3CYBgW7bmTFed4QYv0wCbo40XVy	Citra Smash Pale Ale	{"abv": 5.7, "ibu": 52, "srm": 5, "notes": "Starter calibration batch (CORE_PROGRAM_01). Mash at 67°C (152.6°F) for a fermentable wort; single base malt keeps the grist audit trivial. Dry hop on day 7 for peak Citra saturation.", "style": "American Pale Ale (Smash)", "yeast": {"lab": "SafAle", "code": "US-05", "name": "American Ale", "notes": "Clean; lets Citra dominate. Pitch cool, allow free-rise into low 70s °F.", "style": "Ale", "tempMax": 72, "tempMin": 59, "flavorProfile": ["Neutral", "Slight stone-fruit ester when warm"], "attenuationMax": 77, "attenuationMin": 73, "alcoholTolerance": "Medium (9%)", "flocculationLevel": "Medium"}, "boilTime": 60, "batchSize": 5.5, "batchUnit": "gal", "grainBill": [{"id": "g-smash-base", "name": "Pale 2-Row (US)", "unit": "lb", "weight": 11, "purpose": "Base (Smash)", "lovibond": 1.8, "percentage": 100}], "difficulty": 3, "efficiency": 72, "hopSchedule": [{"id": "h-citra-60", "name": "Citra", "time": 60, "unit": "oz", "weight": 0.6, "addition": "bittering", "timeUnit": "min", "alphaAcid": 12.5, "ibuContribution": 32}, {"id": "h-citra-10", "name": "Citra", "time": 10, "unit": "oz", "weight": 1, "addition": "flavor", "timeUnit": "min", "alphaAcid": 12.5, "ibuContribution": 14}, {"id": "h-citra-fo", "name": "Citra", "time": 0, "unit": "oz", "weight": 2, "addition": "aroma", "timeUnit": "flameout", "alphaAcid": 12.5, "ibuContribution": 6}, {"id": "h-citra-dh", "name": "Citra", "time": 3, "unit": "oz", "weight": 3, "addition": "dry hop", "timeUnit": "days", "alphaAcid": 12.5, "ibuContribution": 0}], "finalGravity": 1.011, "starterPackage": "CORE_PROGRAM_01", "originalGravity": 1.054, "fermentationSchedule": [{"days": 10, "name": "Primary", "notes": "Hold steady; add dry hop around day 7.", "tempMax": 70, "tempMin": 66}, {"days": 3, "name": "Dry hop contact", "notes": "Biotransformation window — avoid O₂ pickup.", "tempMax": 68, "tempMin": 66}]}	t	\N	2026-04-22 08:16:05.924876+00	2026-04-22 08:16:05.924876+00	\N	3	0
\.


--
-- Data for Name: shopping_list_items; Type: TABLE DATA; Schema: api; Owner: postgres
--

COPY api.shopping_list_items (id, user_id, recipe_id, recipe_name, item_name, item_type, quantity_needed, unit, is_purchased, created_at) FROM stdin;
5ee69c80-33c6-4a9c-af24-dc2a622638bf	0f724598-6082-4b93-b5e4-251a97d2a320	bf41f9ca-473a-4cba-8de5-6cfa1a9fec99	Cascade Session IPA	Carapils (Dextrin)	grain	340.2000	g	f	2026-04-05 21:11:42.144174+00
1b0a7c1a-53a6-4d7c-960f-c5a6c920d2d9	0f724598-6082-4b93-b5e4-251a97d2a320	bf41f9ca-473a-4cba-8de5-6cfa1a9fec99	Cascade Session IPA	Cascade	hop	4.0000	oz	f	2026-04-05 21:11:42.144174+00
00f7c2ba-10ca-427d-b09f-d1fc694d9ef2	0f724598-6082-4b93-b5e4-251a97d2a320	bf41f9ca-473a-4cba-8de5-6cfa1a9fec99	Cascade Session IPA	California Ale (WLP001)	yeast	1.0000	pkg	f	2026-04-05 21:11:42.144174+00
43fc2353-ded1-4e83-a958-9b246d611ae2	0f724598-6082-4b93-b5e4-251a97d2a320	bf41f9ca-473a-4cba-8de5-6cfa1a9fec99	Cascade Session IPA	Crystal 15L	grain	340.2000	g	f	2026-04-05 21:11:42.144174+00
76497efb-2204-4812-b02b-f578607d947d	0f724598-6082-4b93-b5e4-251a97d2a320	bf41f9ca-473a-4cba-8de5-6cfa1a9fec99	Cascade Session IPA	Pale 2-Row (US)	grain	3.6300	kg	f	2026-04-05 21:11:42.144174+00
\.


--
-- Data for Name: user_grain_inventory; Type: TABLE DATA; Schema: api; Owner: postgres
--

COPY api.user_grain_inventory (user_id, grain_id, inventory_kg, updated_at) FROM stdin;
0f724598-6082-4b93-b5e4-251a97d2a320	58098b96-ceab-43ae-8555-812e04e25218	2.2680	2026-03-29 23:30:55.425+00
user_3CYBgW7bmTFed4QYv0wCbo40XVy	805ec3f3-baef-480a-90b6-b47b399f9d05	1.8144	2026-04-22 08:40:56.071+00
\.


--
-- Data for Name: yeasts; Type: TABLE DATA; Schema: api; Owner: postgres
--

COPY api.yeasts (id, name, lab, code, type, attenuation_min, attenuation_max, flocculation, temp_min, temp_max, description, styles, created_at, abv_tolerance, sta1_status, diacetyl_production, analogues, usage_count) FROM stdin;
3eb4d73c-5b4c-4b97-afe0-40e913d2ba0c	BE-134	Fermentis	BE-134	Ale	82	88	Low	64	77	Dry saison yeast; STA1-positive — verify terminal gravity and packaging hygiene.	{Saison,"Belgian Pale Ale","Bière de Garde"}	2026-03-29 23:14:48.93527+00	12.0	t	Low	{WY3711,"Belle Saison"}	0
3b808ec1-fc16-4c4b-a295-4bf4b6192b61	Bohemian Lager	Wyeast	WY2124	Lager	69	73	Medium	48	58	World-standard Czech lager; smooth, subtle fruit, long lagering reward.	{"Czech Premium Pale Lager","Czech Dark Lager","Munich Helles"}	2026-03-25 23:44:54.590016+00	11.0	f	Low	{WLP800,S-189}	0
865f1b1f-22ba-4783-bc79-9e3189053480	California Ale	White Labs	WLP001	Ale	73	80	Medium	65	68	The most widely used ale yeast in the world. Clean, crisp, and free of off-flavors. Balances malt and hop character equally.	{"American Pale Ale","West Coast IPA","American Amber Ale","American Stout",Porter}	2026-03-25 23:44:54.590016+00	12.0	f	Low	{WY1056,US-05,A01}	0
984bebe6-9d11-405f-8927-51977695a3ca	Irish Ale	White Labs	WLP004	Ale	69	74	High	65	68	Dublin stout lineage; smooth roast balance with slight sweetness and dry finish.	{"Irish Stout","Irish Red Ale",Porter,"American Stout"}	2026-03-25 23:44:54.590016+00	11.0	f	Low	{WY1084}	0
954ffe39-b70b-42a9-a5e6-3fc61a988cbc	German Ale / Kölsch	White Labs	WLP029	Ale	72	78	Medium	65	69	Clean Kölsch character; subtle fruit, responds well to cold conditioning.	{Kölsch,"Cream Ale","Blonde Ale"}	2026-03-25 23:44:54.590016+00	10.5	f	Low	{WY2565,K-97}	0
9f64976e-f08e-417d-abf5-423d9abfaca3	Hefeweizen Ale	White Labs	WLP300	Wheat	72	76	Low	68	72	Bavarian hefeweizen benchmark; clove/banana balance from temperature.	{Weissbier,"Dunkles Weissbier",Weizenbock}	2026-03-25 23:44:54.590016+00	11.5	f	Low	{WY3068,WB-06}	0
50d2b283-40f1-4fa4-8aa3-6b1bf5619eab	San Diego Super	White Labs	WLP090	Ale	76	83	High	65	68	Highly attenuative, very clean — hops and malt forward without yeast noise.	{"West Coast IPA","Imperial IPA","American Barleywine","Imperial Stout"}	2026-03-25 23:44:54.590016+00	13.5	f	Low	{WLP001,WY1056}	0
59dc65d9-5d44-42ff-8076-ba911ec5fc84	Monastery Ale	White Labs	WLP500	Ale	75	80	Medium	65	72	Trappist-style esters, alcohol warmth, spicy phenolics when fermented warm.	{"Belgian Tripel","Belgian Golden Strong Ale","Belgian Dubbel","Belgian Dark Strong Ale"}	2026-03-25 23:44:54.590016+00	14.0	f	Med	{WY3787,T-58}	0
1c15c95d-5fa9-4673-b356-f82202030d29	Pilsner Lager	White Labs	WLP800	Lager	72	77	Medium	50	55	Czech Pilsner lineage; clean malt, sulfur fades with lagering.	{"Czech Premium Pale Lager","German Pils","Munich Helles"}	2026-03-25 23:44:54.590016+00	11.0	f	Low	{WY2124,W-34/70,Diamond}	0
248913b8-dae7-4cb3-a300-3afbe0bc7ec7	Oktoberfest / Märzen	White Labs	WLP820	Lager	65	73	Medium	52	58	Munich Märzen character; rich malt, clean lager finish.	{Märzen,Festbier,"Munich Dunkel","Vienna Lager"}	2026-03-25 23:44:54.590016+00	11.5	f	Low	{WY2308,S-23}	0
2b701560-703f-4147-a6ef-9df47707ceb5	American Ale	Wyeast	WY1056	Ale	73	77	Medium	60	72	Versatile Chico-type clean ale; slight malt sweetness when young.	{"American Pale Ale","American IPA","American Amber Ale","American Wheat Beer"}	2026-03-25 23:44:54.590016+00	12.0	f	Low	{WLP001,US-05,A01}	0
01231b58-2745-4db7-b8cf-5960ae447d40	London Ale III	Wyeast	WY1318	Ale	71	75	High	64	74	NEIPA classic — soft body, fruit, stable haze with late hops.	{"New England IPA","Hazy IPA","English Bitter"}	2026-03-25 23:44:54.590016+00	11.0	f	Med	{WLP013}	0
c70e38f3-6a4f-42fd-ba66-01a29a3c0500	Trappist High Gravity	Wyeast	WY3787	Ale	74	78	High	64	78	Robust Belgian abbey strain; fruit at cool, phenolic when warm; high OG tolerant.	{"Belgian Tripel","Belgian Dark Strong Ale","Belgian Dubbel"}	2026-03-25 23:44:54.590016+00	14.5	f	Med	{WLP500,T-58}	0
45d7a586-050a-451f-8268-b93caf57817f	Flagship	Imperial Yeast	A01	Ale	73	77	Medium	60	72	Imperial clean American ale; bright, neutral canvas for recipe design.	{"American Pale Ale","American IPA","Blonde Ale","Cream Ale"}	2026-03-25 23:44:54.590016+00	12.0	f	Low	{WLP001,WY1056,US-05}	0
16620f34-7870-41fc-8d3a-95218f276fe6	Darkness	Imperial Yeast	A10	Ale	71	75	Medium	62	72	British dark-ale complexity; stone fruit, cocoa, bourbon hints.	{"Imperial Stout","Oatmeal Stout",Porter,"Sweet Stout"}	2026-03-25 23:44:54.590016+00	12.5	f	Med	{WY1084}	0
16e215a3-8f1f-47ab-8194-a5fc86b9e82e	Global	Imperial Yeast	L13	Lager	73	77	Medium	50	60	Neutral American lager; low sulfur, versatile craft lager base.	{"American Lager","International Pale Lager","German Pils"}	2026-03-25 23:44:54.590016+00	11.0	f	Low	{W-34/70,Diamond}	0
f3468152-a549-459d-a188-98ab45fc4721	Dieter	Imperial Yeast	G03	Hybrid	73	77	Medium	62	72	Kölsch-type hybrid; lager-like crispness at ale temps.	{Kölsch,"Cream Ale",Altbier}	2026-03-25 23:44:54.590016+00	10.5	f	Low	{WLP029,K-97}	0
dc3fb35c-3fde-4f0f-a483-b51c0677d89d	American Ale II	Wyeast	WY1272	Ale	72	76	Medium	60	72	Fruiter than 1056; slight ester, still clean — American & English crossover.	{"American Amber Ale","English Bitter","American Brown Ale"}	2026-03-29 23:14:48.93527+00	11.5	f	Med	{WY1056,WLP001}	0
09fabb07-ba07-45cb-b4cc-ddd1d61715c0	French Saison	Wyeast	WY3711	Ale	77	83	Low	65	80	STA1-positive saison; very high attenuation — verify stable terminal gravity and packaging hygiene.	{Saison,"Bière de Garde","Farmhouse Ale"}	2026-03-29 23:14:48.93527+00	12.0	t	Low	{BE-134,"Belle Saison"}	0
18ec9e75-bbf9-43ea-a926-55248041ec7a	Scottish Ale	Wyeast	WY1728	Ale	69	73	Very High	55	70	Scottish export profile; malt-forward, clean, high floc.	{"Scottish Light","Scottish Heavy","Scottish Export","Wee Heavy"}	2026-03-29 23:14:48.93527+00	11.0	f	Med	{WLP028}	0
cda9217c-6276-4b86-b3e1-6f3a941d4f00	London Ale	Wyeast	WY1028	Ale	73	77	High	60	72	British pale/bitters; light fruit, firm attenuation, good clarity.	{"Best Bitter","Strong Bitter","English IPA"}	2026-03-29 23:14:48.93527+00	11.0	f	Med	{WLP013}	0
93dd7746-4da0-470c-804f-7522717251f9	Irish Ale	Wyeast	WY1084	Ale	69	73	Medium	62	72	Irish stout/red; smooth roast, slight diacetyl acceptable in style.	{"Irish Stout","Irish Red Ale"}	2026-03-29 23:14:48.93527+00	11.0	f	Med	{WLP004}	0
25ffad2e-0bb0-4181-b692-c2e5644a3e41	British Ale	Wyeast	WY1098	Ale	74	82	High	64	72	Whitbread-type; dry finish, minerally, good for bitters and porters.	{"Ordinary Bitter","Dark Mild","London Porter"}	2026-03-29 23:14:48.93527+00	11.5	f	Med	{S-04}	0
bffc2bd9-4386-4008-9ac1-a03e5859dda9	Belgian Abbey II	Wyeast	WY1762	Ale	73	77	Medium	65	75	Abbey dubbel/tripel fruit and spice without extreme phenol.	{"Belgian Dubbel","Belgian Pale Ale","Belgian Blond Ale"}	2026-03-29 23:14:48.93527+00	12.5	f	Med	{T-58}	0
426fff8c-b6c4-41ed-ba5e-f30cf9a28f23	Munich Lager	Wyeast	WY2308	Lager	73	77	Medium	48	58	Märzen/Oktoberfest malt richness with clean lager finish.	{Märzen,Festbier,"Munich Dunkel"}	2026-03-29 23:14:48.93527+00	11.5	f	Low	{WLP820,S-23}	0
43b7082c-c991-45a1-881e-5a4534d268fa	Kölsch	Wyeast	WY2565	Ale	73	77	Medium	56	70	Authentic Kölsch; delicate fruit, crisp finish with lagering.	{Kölsch,"German Leichtbier"}	2026-03-29 23:14:48.93527+00	10.5	f	Low	{WLP029,K-97}	0
fd4b8b93-4e29-48bd-8315-1a421101c221	Brettanomyces Blend	Wyeast	WY3278	Wild	85	90	Low	65	85	Wild blend for mixed fermentation; long aging, funk forward.	{"Wild Specialty Beer","American Wild Ale","Fruit Lambic"}	2026-03-29 23:14:48.93527+00	15.0	f	High	{}	0
0c73d77c-5e56-4280-b72d-429d66866087	American Farmhouse	Wyeast	WY3726	Wild	78	82	Low	65	80	Brett-forward saison character; STA1 risk in some lots — treat as wild protocol.	{Saison,"American Wild Ale"}	2026-03-29 23:14:48.93527+00	12.0	t	Med	{WY3711}	0
fd94ec73-6a43-4dae-a961-7b34169bb655	Brettanomyces bruxellensis	White Labs	WLP650	Wild	85	90	Low	65	85	Single-strain Brett B; barnyard, hay, pineapple with age.	{"Wild Specialty Beer","American Wild Ale"}	2026-03-29 23:14:48.93527+00	15.0	f	High	{}	0
6e0d2a3f-91a4-4399-991e-c57e3dccc610	English Cider	White Labs	WLP775	Ale	85	95	Low	63	75	Cider-focused; clean to semi-dry fermentations.	{"English Cider","New England Cider"}	2026-03-29 23:14:48.93527+00	12.0	f	Low	{}	0
634ef240-f8bf-4b7a-91bb-6af1a20bc59a	English Pub	Imperial Yeast	A07	Ale	69	74	Very High	62	72	British pub ale; malt-accented, finishes clean with excellent clarity.	{"Ordinary Bitter","Best Bitter","Dark Mild","British Strong Ale"}	2026-03-29 23:14:48.93527+00	10.5	f	Med	{WY1968,S-04}	0
4e6335f4-241e-4e24-ba5c-696ab3a04eff	Juice	Imperial Yeast	A38	Ale	72	76	Medium	64	72	Juicy fruit ester profile for hazy and modern hop-forward ales.	{"New England IPA","Hazy Pale Ale","American IPA"}	2026-03-29 23:14:48.93527+00	11.0	f	Med	{WY1318,WLP013}	0
bc90ddf0-dcd3-4018-ae86-87979db9ea22	Independence	Imperial Yeast	A15	Ale	72	76	High	60	72	Clean American ale with slightly more ester than Flagship.	{"American Pale Ale","American Amber Ale","American Brown Ale"}	2026-03-29 23:14:48.93527+00	11.5	f	Low	{A01,WY1056}	0
be8f9e34-d0a3-48b1-a628-cbd187f8b1db	Citrus	Imperial Yeast	A20	Ale	73	77	Medium	64	72	Orange-citrus ester emphasis; complements citrus hops.	{"American IPA","American Pale Ale","Belgian Pale Ale"}	2026-03-29 23:14:48.93527+00	11.5	f	Med	{}	0
3f8d2777-993b-4edf-ab01-5192303e270b	US-05	Fermentis	US-05	Ale	78	82	Medium	59	75	Dried Chico-type; extremely popular neutral American ale yeast.	{"American Pale Ale","West Coast IPA","American Wheat Beer"}	2026-03-29 23:14:48.93527+00	11.5	f	Low	{WLP001,WY1056,A01}	0
9983cda0-a848-4cf9-b27c-e91a4e3819d9	S-04	Fermentis	S-04	Ale	74	82	Very High	59	68	English dry yeast; fast finisher, mild fruit, excellent clarity.	{"English Bitter",Porter,Stout,"English Brown Ale"}	2026-03-29 23:14:48.93527+00	10.5	f	Med	{WY1968,WLP002}	0
edf25459-53b2-498c-b4bf-b9cba32a0ba1	BE-256	Fermentis	BE-256	Ale	82	86	Medium	64	72	Abbey dry yeast; high attenuation Belgian ales.	{"Belgian Blond Ale","Belgian Tripel","Belgian Golden Strong Ale"}	2026-03-29 23:14:48.93527+00	13.0	f	Med	{T-58,WY3787}	0
a5019918-384c-4297-a1d5-b5bdd793342e	English Ale	White Labs	WLP002	Ale	63	70	Very High	65	68	Creamy, full-bodied British strain with soft fruity aroma; dramatic flocculation and clarity.	{"English Bitter","Extra Special Bitter","English Mild","English Brown Ale","Oatmeal Stout"}	2026-03-25 23:44:54.590016+00	10.0	f	Med	{WY1968,S-04}	0
18ab038c-2663-4ba7-9dd2-f95f8761ffdc	WB-06	Fermentis	WB-06	Wheat	70	75	Low	64	72	Wheat beer dry yeast; banana-clove balance.	{Weissbier,"Dunkles Weissbier"}	2026-03-29 23:14:48.93527+00	11.0	f	Low	{WLP300,WY3068}	0
768d5215-1ced-48e8-b8e4-8e5a2ef6d5bc	K-97	Fermentis	K-97	Ale	72	76	High	54	72	German ale dry yeast; clean, slightly sulfur, Kölsch-friendly.	{Kölsch,Altbier,"German Pale Ale"}	2026-03-29 23:14:48.93527+00	10.5	f	Low	{WLP029,WY2565}	0
49c3a448-38f1-45a3-a704-e860e078ce4f	W-34/70	Fermentis	W-34/70	Lager	72	76	High	48	56	Weihenstephan lager dry; clean, flexible craft lager workhorse.	{"German Pils","Munich Helles",Festbier,Bock}	2026-03-29 23:14:48.93527+00	11.5	f	Low	{Diamond,WY2124}	0
559223fe-1ed1-4393-b5ee-153cef65d21b	S-189	Fermentis	S-189	Lager	72	76	High	48	56	Lager dry yeast; malty-nutty nuance, good for amber lagers.	{Märzen,"Vienna Lager","Czech Dark Lager"}	2026-03-29 23:14:48.93527+00	11.5	f	Low	{WY2308}	0
101e30f8-3519-4581-954c-0543c035cde7	S-23	Fermentis	S-23	Lager	72	76	Medium	46	56	Estery lager option; useful for pseudo-lagers and fruit lagers.	{"International Pale Lager","Cream Ale"}	2026-03-29 23:14:48.93527+00	10.5	f	Med	{}	0
f622a0e0-c9f2-405b-9d5a-bdc9ffdd92ed	T-58	Fermentis	T-58	Ale	75	80	Medium	64	72	Belgian dry blend; spicy phenol, moderate fruit.	{"Belgian Dubbel","Belgian Tripel",Saison}	2026-03-29 23:14:48.93527+00	12.5	f	Med	{WLP500,WY3787}	0
456fcc41-7c52-4edf-9004-c2ecdcc1fae7	Diamond	Lallemand	Diamond	Lager	72	76	High	48	56	German lager dry; clean, low sulfur, Bock to Pils.	{"German Pils","Munich Helles",Bock,Schwarzbier}	2026-03-29 23:14:48.93527+00	11.5	f	Low	{W-34/70,WLP800}	0
96ccd24f-4d84-48c1-aabc-92c25b808206	Voss Kveik	Lallemand	Voss	Ale	75	82	High	68	98	Norwegian kveik; rapid ferment, orange-citrus ester at high temps.	{"American IPA","Pale Ale","Strong Ale",Experimental}	2026-03-29 23:14:48.93527+00	13.5	f	Low	{}	0
2ed442bc-53de-4e38-8681-0340832f80a8	Nottingham	Lallemand	Nottingham	Ale	75	80	High	57	70	English dry; very clean at low temps, neutral American ale substitute.	{"English Bitter","American Pale Ale",Porter}	2026-03-29 23:14:48.93527+00	11.5	f	Low	{US-05}	0
4134e6dc-e9e1-4f32-bacb-fbba9d723b86	BRY-97	Lallemand	BRY-97	Ale	73	77	High	59	72	West Coast IPA dry option; clean, slight stone fruit.	{"West Coast IPA","American IPA","American Pale Ale"}	2026-03-29 23:14:48.93527+00	12.5	f	Low	{WLP001,US-05}	0
c657560a-4e44-4612-bd63-3578ec60d4dd	Munich Classic	Lallemand	Munich Classic	Lager	70	74	Medium	48	55	Munich lager dry; malty, smooth, festbier-friendly.	{Märzen,"Munich Dunkel",Festbier}	2026-03-29 23:14:48.93527+00	11.5	f	Low	{WY2308}	0
fa1329f7-2008-49e9-999e-1d31bd3cd206	Belle Saison	Lallemand	Belle Saison	Ale	80	85	Low	63	77	Diastatic saison dry yeast — treat as STA1-positive for QC and packaging.	{Saison,"Belgian Pale Ale"}	2026-03-29 23:14:48.93527+00	12.0	t	Low	{WY3711,BE-134}	0
e74f0154-f0ef-4814-ab9e-cf6e6a054c25	London III	White Labs	WLP013	Ale	71	75	High	64	72	Popular for soft IPAs; similar niche to London Ale III.	{"New England IPA","Hazy IPA","English Bitter"}	2026-03-29 23:14:48.93527+00	11.0	f	Med	{WY1318}	0
bc7e2dfd-9661-44e3-8270-254229915a1b	California V Ale	White Labs	WLP051	Ale	73	78	Medium	65	70	California ale with slightly more ester than WLP001.	{"American Amber Ale","California Common","American Brown Ale"}	2026-03-29 23:14:48.93527+00	11.5	f	Med	{WY1272}	0
b4dbf420-fd89-46ae-b97e-8443c0fab37c	American Hefeweizen IV	White Labs	WLP320	Wheat	72	76	Low	65	69	American wheat; restrained banana compared to WLP300.	{"American Wheat Beer","Fruit Beer"}	2026-03-29 23:14:48.93527+00	10.5	f	Low	{}	0
904ea862-ba87-4411-8ae7-9000c57b7858	East Coast Ale	White Labs	WLP008	Ale	70	75	Medium	62	72	Mild fruit, low diacetyl; East Coast pale ale heritage.	{"American Pale Ale","American Amber Ale"}	2026-03-29 23:14:48.93527+00	11.0	f	Low	{}	0
3dce58de-b6d1-49eb-b069-ffcd041d640c	Whitbread Ale	White Labs	WLP017	Ale	73	77	High	65	70	British versatile; dry finish, slight mineral.	{"Best Bitter",Porter,Stout}	2026-03-29 23:14:48.93527+00	11.5	f	Med	{WY1098}	0
ba63d78c-54cc-4b96-9a22-43dd4dbec2e1	Brettanomyces claussenii	White Labs	WLP645	Wild	85	90	Low	65	85	Mild Brett C; pineapple, tropical over months.	{"American Wild Ale","Wild Specialty Beer"}	2026-03-29 23:14:48.93527+00	14.0	f	High	{}	0
5f40cece-176e-4ddc-8803-334dd180b278	American Farmhouse Blend	White Labs	WLP670	Wild	80	85	Low	65	80	Mixed culture saison/wild; verify STA with supplier COA.	{Saison,"American Wild Ale"}	2026-03-29 23:14:48.93527+00	12.0	t	Med	{WY3726}	0
f4971d83-7093-4e91-90fc-c33c77d7395d	Cry Havoc	Wyeast	WY1388	Hybrid	72	76	Medium	55	68	Licensed Ringwood-type; fruity British, can finish diacetyl with rest.	{"English IPA","Strong Bitter","Old Ale"}	2026-03-29 23:14:48.93527+00	11.0	f	High	{}	0
357d79fb-3c7c-4eed-a9f2-6267009f5d81	Thames Valley Ale	Wyeast	WY1275	Ale	71	75	Very High	62	72	British; minerally, dry, brilliant clarity.	{"Best Bitter","Strong Bitter","English IPA"}	2026-03-29 23:14:48.93527+00	11.0	f	Med	{}	0
811e095d-fd30-40f7-a575-c131f1985a92	Roeselare Blend	Wyeast	WY3763	Wild	80	90	Low	65	85	Flanders-type sour blend; long aging, acid forward.	{"Flanders Red Ale","Oud Bruin"}	2026-03-29 23:14:48.93527+00	12.0	f	High	{}	0
af49fe5c-b719-4d74-8e24-ab2d68ff8eb9	Belgian Ardennes	Wyeast	WY3522	Ale	72	76	High	65	80	Spicy Belgian character; clean at low temps, more ester warm.	{"Belgian Blond Ale","Belgian Golden Strong Ale","Belgian Tripel"}	2026-03-29 23:14:48.93527+00	12.5	f	Med	{T-58,BE-256}	0
03c13db2-0c02-4503-8359-1b289fee8071	London ESB Ale	Wyeast	WY1968	Ale	67	71	Very High	64	72	Full ESB character; extreme flocculation, nutty-malty profile.	{"Extra Special Bitter","Best Bitter","English Porter"}	2026-03-25 23:44:54.590016+00	10.5	f	Med	{WLP002,S-04}	0
720a096a-d1d1-4af8-af81-e790a29a18a6	Weihenstephan Weizen	Wyeast	WY3068	Wheat	73	77	Low	64	75	Weihenstephan lineage; bold banana-clove hefeweizen.	{Weissbier,"Dunkles Weissbier",Weizenbock}	2026-03-25 23:44:54.590016+00	11.5	f	Low	{WLP300,WB-06}	0
0ef411d0-328d-4649-b159-fd9e53718d59	Belgian Wit Ale	White Labs	WLP400	Wheat	74	78	Low	62	72	Witbier; orange peel/coriander synergy, hazy.	{Witbier}	2026-03-29 23:14:48.93527+00	10.5	f	Med	{WY3942}	0
de837a9f-6892-4199-8304-8ca2526d0fe2	Edinburgh Ale	White Labs	WLP028	Ale	70	75	Very High	65	70	Edinburgh-type; malt-forward, slight peat smoke perception in some worts.	{"Scottish Light","Scottish Heavy","Scottish Export","Wee Heavy"}	2026-03-29 23:14:48.93527+00	11.5	f	Med	{WY1728}	0
b37f93a0-5110-4bf6-90e7-f430e4733d6e	San Francisco Lager	Wyeast	WY2112	Hybrid	68	73	High	58	65	Steam beer / California Common; lager character at ale temperatures.	{"California Common"}	2026-03-29 23:14:48.93527+00	10.5	f	Med	{WLP810}	0
85ed7bff-5e64-47ca-8f99-828f6e98c450	San Francisco Lager	White Labs	WLP810	Hybrid	68	73	High	58	65	White Labs California Common strain; clean lager-like profile warm.	{"California Common"}	2026-03-29 23:14:48.93527+00	10.5	f	Med	{WY2112}	0
\.


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

