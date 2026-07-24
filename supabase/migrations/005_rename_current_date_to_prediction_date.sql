-- 005: rename predictions.current_date -> prediction_date on pre-existing databases.
--
-- WHY:
--  Commit a9d5439 ("fix: avoid reserved prediction date column") renamed this
--  column by EDITING 001_create_predictions.sql in place, and updated the
--  application code to match. Editing a migration that has already run does not
--  change a database that already ran it, and no ALTER ... RENAME was ever
--  shipped.
--
--  Result: any project provisioned before 2026-05-06 still has a column named
--  `current_date`, while the code selects `prediction_date`. That makes the wide
--  select in /api/forecast-history fail with 42703 (undefined_column) and return
--  HTTP 500, while the narrow lazy-resolve select — which does not reference the
--  column — keeps working. See issue #106.
--
--  `current_date` is a reserved word in SQL (it is a niladic function), which is
--  why the rename happened in the first place; it must be quoted to be addressed
--  as an identifier.
--
-- SAFETY:
--  Fully idempotent and safe to run on any database:
--   - old column present, new absent  -> rename (the drifted case)
--   - new column already present      -> no-op (freshly provisioned, or re-run)
--   - neither present                 -> no-op, and we raise so a genuinely
--                                        broken table is not silently accepted
--  RENAME COLUMN carries the UNIQUE constraint and any indexes over with it, so
--  no constraint or index has to be rebuilt.

DO $$
DECLARE
  has_old boolean;
  has_new boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'predictions'
      AND column_name  = 'current_date'
  ) INTO has_old;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'predictions'
      AND column_name  = 'prediction_date'
  ) INTO has_new;

  IF has_old AND NOT has_new THEN
    EXECUTE 'ALTER TABLE public.predictions RENAME COLUMN "current_date" TO prediction_date';
    RAISE NOTICE '005: renamed predictions."current_date" -> prediction_date';

  ELSIF has_new AND has_old THEN
    -- Both present: a partial manual repair. Refuse to guess which one holds the
    -- real data rather than silently dropping a column.
    RAISE EXCEPTION
      '005: predictions has BOTH "current_date" and prediction_date. Resolve manually before re-running.';

  ELSIF has_new THEN
    RAISE NOTICE '005: prediction_date already present, nothing to do';

  ELSE
    RAISE EXCEPTION
      '005: predictions has neither "current_date" nor prediction_date — schema is not in a state this migration understands.';
  END IF;
END $$;
