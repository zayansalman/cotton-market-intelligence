-- Store the full chart path for each generated market forecast.
ALTER TABLE predictions
ADD COLUMN IF NOT EXISTS forecast_points jsonb NOT NULL DEFAULT '[]'::jsonb;
