-- Predictions table: stores every forecast for accuracy tracking
CREATE TABLE predictions (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at      timestamptz DEFAULT now() NOT NULL,

  -- When the prediction was made and what it saw
  current_date    date NOT NULL,
  current_price   numeric(8,4) NOT NULL,

  -- What it predicted
  horizon         text NOT NULL,
  target_date     date NOT NULL,
  predicted_price numeric(8,4) NOT NULL,
  lower_price     numeric(8,4),
  upper_price     numeric(8,4),
  direction       text NOT NULL,
  confidence      smallint,

  -- Model metadata
  model_id        text NOT NULL,
  model_name      text,
  reasoning       text,

  -- Accuracy (filled when target_date passes)
  actual_price      numeric(8,4),
  direction_correct boolean,
  error_pct         numeric(6,3),

  -- One prediction per (current_date, horizon, model_id)
  UNIQUE (current_date, horizon, model_id)
);

CREATE INDEX idx_predictions_target_date ON predictions (target_date);
CREATE INDEX idx_predictions_resolved ON predictions (actual_price) WHERE actual_price IS NOT NULL;
