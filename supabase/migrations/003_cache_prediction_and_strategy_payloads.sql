-- Cache complete API responses so repeated same-day forecasts and exact
-- strategy requests can be served from Supabase without rerunning model/LLM work.
ALTER TABLE predictions
ADD COLUMN IF NOT EXISTS response_payload jsonb;

CREATE INDEX IF NOT EXISTS idx_predictions_response_cache
ON predictions (prediction_date, horizon, created_at DESC)
WHERE response_payload IS NOT NULL;

CREATE TABLE IF NOT EXISTS strategies (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at      timestamptz DEFAULT now() NOT NULL,
  strategy_date   date NOT NULL,
  cache_key       text NOT NULL UNIQUE,
  request_payload jsonb NOT NULL,
  response_payload jsonb NOT NULL,

  provider        text,
  source          text,
  signal          text,
  confidence      smallint,
  prediction_date date,
  horizon         text
);

CREATE INDEX IF NOT EXISTS idx_strategies_strategy_date
ON strategies (strategy_date DESC);

CREATE INDEX IF NOT EXISTS idx_strategies_created_at
ON strategies (created_at DESC);
