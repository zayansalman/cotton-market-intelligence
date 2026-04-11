/**
 * Server-side Supabase client singleton.
 *
 * Uses service role key — never import this from client components.
 * Returns null if env vars are missing (graceful degradation for local dev).
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  _client = createClient(url, key);
  return _client;
}

/**
 * Add N business days (Mon–Fri) to a YYYY-MM-DD date string.
 * Returns YYYY-MM-DD string.
 */
export function addBusinessDays(startDate: string, days: number): string {
  const d = new Date(startDate + "T00:00:00Z");
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}
