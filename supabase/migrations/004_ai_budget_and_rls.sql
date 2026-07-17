-- 004: durable global AI-budget counter + row-level security lockdown.
--
-- WHY:
--  (1) The in-memory AI usage quota (src/lib/usage-quota.ts) is per serverless
--      instance, so a determined caller can bypass the global daily AI budget
--      by fanning out across instances → cost runaway. This adds an atomic,
--      cross-instance counter as the durable cost guardrail.
--  (2) predictions/strategies had no RLS. With the anon key (NEXT_PUBLIC_*)
--      fallback in getSupabase(), that left forecast/strategy data readable and
--      writable by anyone holding the public anon key. Enabling RLS with no
--      anon/authenticated policies makes those roles fail-closed; the server's
--      service-role key bypasses RLS and keeps working.

/* ------------------------------------------------------------------ */
/*  Durable global AI-budget counter                                  */
/* ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS ai_usage_daily (
  usage_date date PRIMARY KEY,
  count      integer NOT NULL DEFAULT 0
);

-- Atomically increment today's counter and return the new value. SECURITY
-- DEFINER so it runs with the table owner's rights; callers never touch the
-- table directly.
CREATE OR REPLACE FUNCTION increment_ai_usage(p_date date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count integer;
BEGIN
  INSERT INTO ai_usage_daily (usage_date, count)
  VALUES (p_date, 1)
  ON CONFLICT (usage_date)
  DO UPDATE SET count = ai_usage_daily.count + 1
  RETURNING count INTO new_count;
  RETURN new_count;
END;
$$;

-- Only the server (service_role) may increment the budget. Deny the public
-- API roles so an anon-key holder cannot inflate or read the counter.
REVOKE ALL ON FUNCTION increment_ai_usage(date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION increment_ai_usage(date) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_ai_usage(date) TO service_role;

ALTER TABLE ai_usage_daily ENABLE ROW LEVEL SECURITY;
-- No policies for anon/authenticated → those roles get zero rows.
-- service_role bypasses RLS entirely.

/* ------------------------------------------------------------------ */
/*  Lock down existing tables                                          */
/* ------------------------------------------------------------------ */

ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategies ENABLE ROW LEVEL SECURITY;
-- Intentionally NO anon/authenticated policies: reads/writes must use the
-- server-side service-role key. Deployments configured with only the anon key
-- degrade gracefully (cache reads return null; writes are non-fatal).
