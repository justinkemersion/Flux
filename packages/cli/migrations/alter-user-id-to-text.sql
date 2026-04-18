-- Cast user-reference UUID columns to TEXT across yeast-coast tables.
-- FKs must be dropped first: child FKs → profiles_id_fkey, then alter auth.users.id,
-- profiles.id, then child columns, then recreate FKs.
--
-- Derived from yeast-coast (user_id / author_id) + Supabase FK graph in yeastcoast_dump.sql.
-- Safe on public-only, api-only, or both; skips missing objects.
--
-- Apply: flux push -p <project> packages/cli/migrations/alter-user-id-to-text.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Drop foreign keys (children before profiles_id_fkey)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  sch text;
BEGIN
  FOREACH sch IN ARRAY ARRAY['public', 'api']::text[]
  LOOP
    IF to_regclass(format('%I.%I', sch, 'batches')) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE %I.batches DROP CONSTRAINT IF EXISTS batches_user_id_fkey',
        sch
      );
    END IF;
    IF to_regclass(format('%I.%I', sch, 'recipes')) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE %I.recipes DROP CONSTRAINT IF EXISTS recipes_user_id_fkey',
        sch
      );
    END IF;
    IF to_regclass(format('%I.%I', sch, 'equipment')) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE %I.equipment DROP CONSTRAINT IF EXISTS equipment_user_id_fkey',
        sch
      );
    END IF;
    IF to_regclass(format('%I.%I', sch, 'inventory')) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE %I.inventory DROP CONSTRAINT IF EXISTS inventory_user_id_fkey',
        sch
      );
    END IF;
    IF to_regclass(format('%I.%I', sch, 'shopping_list_items')) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE %I.shopping_list_items DROP CONSTRAINT IF EXISTS shopping_list_items_user_id_fkey',
        sch
      );
    END IF;
    IF to_regclass(format('%I.%I', sch, 'user_grain_inventory')) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE %I.user_grain_inventory DROP CONSTRAINT IF EXISTS user_grain_inventory_user_id_fkey',
        sch
      );
    END IF;
    IF to_regclass(format('%I.%I', sch, 'brew_logs')) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE %I.brew_logs DROP CONSTRAINT IF EXISTS brew_logs_author_id_fkey',
        sch
      );
    END IF;
    IF to_regclass(format('%I.%I', sch, 'brew_log_comments')) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE %I.brew_log_comments DROP CONSTRAINT IF EXISTS brew_log_comments_author_id_fkey',
        sch
      );
    END IF;
    IF to_regclass(format('%I.%I', sch, 'profiles')) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE %I.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey',
        sch
      );
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Alter auth.users.id and profiles.id (referenced keys)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'auth'
        AND table_name = 'users'
        AND column_name = 'id'
        AND udt_name = 'uuid'
    ) THEN
      ALTER TABLE auth.users
        ALTER COLUMN id TYPE TEXT USING id::text;
    END IF;
  END IF;
END $$;

DO $$
DECLARE
  sch text;
BEGIN
  FOREACH sch IN ARRAY ARRAY['public', 'api']::text[]
  LOOP
    IF to_regclass(format('%I.%I', sch, 'profiles')) IS NOT NULL THEN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = sch
          AND table_name = 'profiles'
          AND column_name = 'id'
          AND udt_name = 'uuid'
      ) THEN
        EXECUTE format(
          'ALTER TABLE %I.profiles ALTER COLUMN id TYPE TEXT USING id::text',
          sch
        );
      END IF;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Alter child columns (user_id / author_id)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT * FROM (
      VALUES
        ('public', 'batches', 'user_id'),
        ('public', 'equipment', 'user_id'),
        ('public', 'inventory', 'user_id'),
        ('public', 'recipes', 'user_id'),
        ('public', 'shopping_list_items', 'user_id'),
        ('public', 'user_grain_inventory', 'user_id'),
        ('public', 'brew_logs', 'author_id'),
        ('public', 'brew_log_comments', 'author_id'),
        ('api', 'batches', 'user_id'),
        ('api', 'equipment', 'user_id'),
        ('api', 'inventory', 'user_id'),
        ('api', 'recipes', 'user_id'),
        ('api', 'shopping_list_items', 'user_id'),
        ('api', 'user_grain_inventory', 'user_id'),
        ('api', 'brew_logs', 'author_id'),
        ('api', 'brew_log_comments', 'author_id')
    ) AS t(table_schema, table_name, column_name)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = rec.table_schema
        AND c.table_name = rec.table_name
        AND c.column_name = rec.column_name
        AND c.udt_name = 'uuid'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.%I ALTER COLUMN %I TYPE TEXT USING %I::text',
        rec.table_schema,
        rec.table_name,
        rec.column_name,
        rec.column_name
      );
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Recreate foreign keys (only when both ends exist and types match TEXT)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  sch text;
BEGIN
  FOREACH sch IN ARRAY ARRAY['public', 'api']::text[]
  LOOP
    IF to_regclass(format('%I.%I', sch, 'profiles')) IS NOT NULL
       AND to_regclass('auth.users') IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'profiles_id_fkey'
          AND conrelid = format('%I.%I', sch, 'profiles')::regclass
      ) THEN
        EXECUTE format(
          $f$
            ALTER TABLE %I.profiles
              ADD CONSTRAINT profiles_id_fkey
              FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
          $f$,
          sch
        );
      END IF;
    END IF;

    IF to_regclass(format('%I.%I', sch, 'batches')) IS NOT NULL
       AND to_regclass('auth.users') IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'batches_user_id_fkey'
          AND conrelid = format('%I.%I', sch, 'batches')::regclass
      ) THEN
        EXECUTE format(
          $f$
            ALTER TABLE %I.batches
              ADD CONSTRAINT batches_user_id_fkey
              FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
          $f$,
          sch
        );
      END IF;
    END IF;

    IF to_regclass(format('%I.%I', sch, 'recipes')) IS NOT NULL
       AND to_regclass('auth.users') IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'recipes_user_id_fkey'
          AND conrelid = format('%I.%I', sch, 'recipes')::regclass
      ) THEN
        EXECUTE format(
          $f$
            ALTER TABLE %I.recipes
              ADD CONSTRAINT recipes_user_id_fkey
              FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
          $f$,
          sch
        );
      END IF;
    END IF;

    IF to_regclass(format('%I.%I', sch, 'equipment')) IS NOT NULL
       AND to_regclass(format('%I.%I', sch, 'profiles')) IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'equipment_user_id_fkey'
          AND conrelid = format('%I.%I', sch, 'equipment')::regclass
      ) THEN
        EXECUTE format(
          $f$
            ALTER TABLE %I.equipment
              ADD CONSTRAINT equipment_user_id_fkey
              FOREIGN KEY (user_id) REFERENCES %I.profiles(id) ON DELETE CASCADE
          $f$,
          sch,
          sch
        );
      END IF;
    END IF;

    IF to_regclass(format('%I.%I', sch, 'inventory')) IS NOT NULL
       AND to_regclass(format('%I.%I', sch, 'profiles')) IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'inventory_user_id_fkey'
          AND conrelid = format('%I.%I', sch, 'inventory')::regclass
      ) THEN
        EXECUTE format(
          $f$
            ALTER TABLE %I.inventory
              ADD CONSTRAINT inventory_user_id_fkey
              FOREIGN KEY (user_id) REFERENCES %I.profiles(id) ON DELETE CASCADE
          $f$,
          sch,
          sch
        );
      END IF;
    END IF;

    IF to_regclass(format('%I.%I', sch, 'shopping_list_items')) IS NOT NULL
       AND to_regclass(format('%I.%I', sch, 'profiles')) IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'shopping_list_items_user_id_fkey'
          AND conrelid = format('%I.%I', sch, 'shopping_list_items')::regclass
      ) THEN
        EXECUTE format(
          $f$
            ALTER TABLE %I.shopping_list_items
              ADD CONSTRAINT shopping_list_items_user_id_fkey
              FOREIGN KEY (user_id) REFERENCES %I.profiles(id) ON DELETE CASCADE
          $f$,
          sch,
          sch
        );
      END IF;
    END IF;

    IF to_regclass(format('%I.%I', sch, 'user_grain_inventory')) IS NOT NULL
       AND to_regclass(format('%I.%I', sch, 'profiles')) IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_grain_inventory_user_id_fkey'
          AND conrelid = format('%I.%I', sch, 'user_grain_inventory')::regclass
      ) THEN
        EXECUTE format(
          $f$
            ALTER TABLE %I.user_grain_inventory
              ADD CONSTRAINT user_grain_inventory_user_id_fkey
              FOREIGN KEY (user_id) REFERENCES %I.profiles(id) ON DELETE CASCADE
          $f$,
          sch,
          sch
        );
      END IF;
    END IF;

    IF to_regclass(format('%I.%I', sch, 'brew_logs')) IS NOT NULL
       AND to_regclass(format('%I.%I', sch, 'profiles')) IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'brew_logs_author_id_fkey'
          AND conrelid = format('%I.%I', sch, 'brew_logs')::regclass
      ) THEN
        EXECUTE format(
          $f$
            ALTER TABLE %I.brew_logs
              ADD CONSTRAINT brew_logs_author_id_fkey
              FOREIGN KEY (author_id) REFERENCES %I.profiles(id) ON DELETE CASCADE
          $f$,
          sch,
          sch
        );
      END IF;
    END IF;

    IF to_regclass(format('%I.%I', sch, 'brew_log_comments')) IS NOT NULL
       AND to_regclass(format('%I.%I', sch, 'profiles')) IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'brew_log_comments_author_id_fkey'
          AND conrelid = format('%I.%I', sch, 'brew_log_comments')::regclass
      ) THEN
        EXECUTE format(
          $f$
            ALTER TABLE %I.brew_log_comments
              ADD CONSTRAINT brew_log_comments_author_id_fkey
              FOREIGN KEY (author_id) REFERENCES %I.profiles(id) ON DELETE CASCADE
          $f$,
          sch,
          sch
        );
      END IF;
    END IF;
  END LOOP;
END $$;

COMMIT;
