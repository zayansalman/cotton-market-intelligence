/**
 * Durable, cross-instance global AI-budget guardrail.
 *
 * The in-memory quota in `usage-quota.ts` is per serverless instance, so the
 * global daily AI budget can be bypassed by fanning out requests across
 * instances (each starts its counter at zero). This module backs the GLOBAL
 * budget with an atomic Supabase counter so the cost cap holds regardless of
 * how many instances are warm.
 *
 * Design goals:
 *  - Atomic increment (via the `increment_ai_usage` RPC in migration 004).
 *  - FAIL OPEN: any Supabase/RPC error (incl. an unapplied migration) must
 *    never break the product — it degrades to the in-memory guardrail only.
 *  - No-op when Supabase is not configured (self-hosted / local dev).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Minimal shape we need — keeps this testable without the full client. */
export interface AiBudgetRpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>
  ): Promise<{ data: unknown; error: unknown }>;
}

export interface GlobalAiBudgetResult {
  /** Whether this AI call is within the global daily budget. */
  allowed: boolean;
  /** Post-increment global count for the day, or null when unknown. */
  count: number | null;
  /** True when the durable counter was consulted (Supabase present, no error). */
  durable: boolean;
}

function globalDailyLimit(): number {
  const raw = process.env.QUOTA_AI_GLOBAL_DAILY;
  const parsed = raw != null ? Number(raw) : 1000;
  if (!Number.isFinite(parsed)) return 1000;
  // 0 = unlimited (mirrors usage-quota.ts semantics).
  return Math.min(Math.max(parsed, 0), 1_000_000);
}

/** UTC day key (YYYY-MM-DD) used as the counter's primary key. */
export function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Atomically reserve one unit of the global daily AI budget.
 *
 * Returns `allowed: true, durable: false` (fail open) when Supabase is absent
 * or the RPC errors, so callers still get the in-memory guardrail and are
 * never hard-blocked by an infrastructure hiccup.
 */
export async function reserveGlobalAiBudget(
  client: (SupabaseClient | AiBudgetRpcClient) | null,
  opts: { limit?: number; today?: string } = {}
): Promise<GlobalAiBudgetResult> {
  const limit = opts.limit ?? globalDailyLimit();
  if (!client || limit <= 0) {
    // No durable store, or unlimited budget → nothing to enforce here.
    return { allowed: true, count: null, durable: false };
  }

  const today = opts.today ?? utcDayKey();
  try {
    const { data, error } = await client.rpc("increment_ai_usage", {
      p_date: today,
    });
    if (error || typeof data !== "number") {
      return { allowed: true, count: null, durable: false };
    }
    return { allowed: data <= limit, count: data, durable: true };
  } catch {
    return { allowed: true, count: null, durable: false };
  }
}
