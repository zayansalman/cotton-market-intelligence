/**
 * Usage quotas and inference cost guardrails (#20).
 *
 * In-memory per-IP daily/monthly counters for AI strategy calls.
 * When quota is exhausted, strategy gracefully degrades to heuristic.
 *
 * All limits are configurable via environment variables.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface QuotaConfig {
  /** Max AI strategy calls per IP per day. 0 = unlimited. */
  daily_limit: number;
  /** Max AI strategy calls per IP per month. 0 = unlimited. */
  monthly_limit: number;
  /** Max AI calls globally per day (across all users). 0 = unlimited. */
  global_daily_limit: number;
  /** Warn in logs when global daily usage exceeds this %. */
  alert_threshold_pct: number;
}

interface UsageBucket {
  daily: number;
  monthly: number;
  daily_reset: number; // epoch ms — start of current day
  monthly_reset: number; // epoch ms — start of current month
}

export interface QuotaResult {
  allowed: boolean;
  reason?: string;
  remaining_daily: number;
  remaining_monthly: number;
  degraded_to_heuristic: boolean;
  headers: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/*  Config from environment                                            */
/* ------------------------------------------------------------------ */

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

function loadConfig(): QuotaConfig {
  const env = (key: string, fallback: number) => {
    const v = process.env[key];
    return v != null ? Number(v) : fallback;
  };

  return {
    daily_limit: clamp(env("QUOTA_AI_DAILY_PER_IP", 50), 0, 10_000),
    monthly_limit: clamp(env("QUOTA_AI_MONTHLY_PER_IP", 500), 0, 100_000),
    global_daily_limit: clamp(env("QUOTA_AI_GLOBAL_DAILY", 1000), 0, 1_000_000),
    alert_threshold_pct: clamp(env("QUOTA_ALERT_THRESHOLD_PCT", 80), 0, 100),
  };
}

/* ------------------------------------------------------------------ */
/*  In-memory storage                                                  */
/* ------------------------------------------------------------------ */

const perIpBuckets = new Map<string, UsageBucket>();
let globalDaily = { count: 0, reset: startOfDay() };

function startOfDay(): number {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfMonth(): number {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function getBucket(ip: string): UsageBucket {
  const now = Date.now();
  const dayStart = startOfDay();
  const monthStart = startOfMonth();

  let bucket = perIpBuckets.get(ip);
  if (!bucket) {
    bucket = { daily: 0, monthly: 0, daily_reset: dayStart, monthly_reset: monthStart };
    perIpBuckets.set(ip, bucket);
  }

  // Roll over if day/month changed
  if (bucket.daily_reset < dayStart) {
    bucket.daily = 0;
    bucket.daily_reset = dayStart;
  }
  if (bucket.monthly_reset < monthStart) {
    bucket.monthly = 0;
    bucket.monthly_reset = monthStart;
  }

  // Roll over global
  if (globalDaily.reset < dayStart) {
    globalDaily = { count: 0, reset: dayStart };
  }

  return bucket;
}

/** Periodic cleanup of stale buckets (>2 days old). */
function pruneStale(): void {
  const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
  for (const [ip, bucket] of perIpBuckets) {
    if (bucket.daily_reset < cutoff) {
      perIpBuckets.delete(ip);
    }
  }
}

// Prune every 10 minutes
let pruneInterval: ReturnType<typeof setInterval> | null = null;
if (typeof globalThis !== "undefined" && !pruneInterval) {
  pruneInterval = setInterval(pruneStale, 10 * 60 * 1000);
  if (pruneInterval.unref) pruneInterval.unref();
}

/* ------------------------------------------------------------------ */
/*  Extract IP (same logic as rate-limit.ts)                           */
/* ------------------------------------------------------------------ */

function extractIp(req: Request): string {
  const hdrs = req.headers;
  const xff = hdrs.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = hdrs.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Check whether this request is allowed to use AI inference.
 * Call BEFORE making hosted AI calls.
 *
 * If not allowed, returns `degraded_to_heuristic: true` — the caller
 * should skip AI and fall back to heuristic directly.
 */
export function checkAiQuota(req: Request): QuotaResult {
  const config = loadConfig();
  const ip = extractIp(req);
  const bucket = getBucket(ip);

  const headers: Record<string, string> = {};

  // Per-IP daily check
  if (config.daily_limit > 0 && bucket.daily >= config.daily_limit) {
    const resetSec = Math.ceil((bucket.daily_reset + 86_400_000 - Date.now()) / 1000);
    headers["X-Quota-Daily-Limit"] = String(config.daily_limit);
    headers["X-Quota-Daily-Remaining"] = "0";
    headers["X-Quota-Reset"] = String(resetSec);
    return {
      allowed: false,
      reason: `Daily AI quota exceeded (${config.daily_limit}/day). Strategy will use heuristic mode.`,
      remaining_daily: 0,
      remaining_monthly: Math.max(0, config.monthly_limit - bucket.monthly),
      degraded_to_heuristic: true,
      headers,
    };
  }

  // Per-IP monthly check
  if (config.monthly_limit > 0 && bucket.monthly >= config.monthly_limit) {
    headers["X-Quota-Monthly-Limit"] = String(config.monthly_limit);
    headers["X-Quota-Monthly-Remaining"] = "0";
    return {
      allowed: false,
      reason: `Monthly AI quota exceeded (${config.monthly_limit}/month). Strategy will use heuristic mode.`,
      remaining_daily: Math.max(0, config.daily_limit - bucket.daily),
      remaining_monthly: 0,
      degraded_to_heuristic: true,
      headers,
    };
  }

  // Global daily check
  if (config.global_daily_limit > 0 && globalDaily.count >= config.global_daily_limit) {
    return {
      allowed: false,
      reason: "Global daily AI budget reached. Strategy will use heuristic mode.",
      remaining_daily: Math.max(0, config.daily_limit - bucket.daily),
      remaining_monthly: Math.max(0, config.monthly_limit - bucket.monthly),
      degraded_to_heuristic: true,
      headers,
    };
  }

  // Alert threshold check (log only)
  if (
    config.global_daily_limit > 0 &&
    config.alert_threshold_pct > 0 &&
    globalDaily.count >= Math.floor(config.global_daily_limit * config.alert_threshold_pct / 100)
  ) {
    console.warn(
      `[quota] Global AI usage at ${globalDaily.count}/${config.global_daily_limit} ` +
      `(${Math.round((globalDaily.count / config.global_daily_limit) * 100)}%) — approaching limit`
    );
  }

  const remainDaily = config.daily_limit > 0
    ? config.daily_limit - bucket.daily - 1
    : -1; // unlimited
  const remainMonthly = config.monthly_limit > 0
    ? config.monthly_limit - bucket.monthly - 1
    : -1;

  headers["X-Quota-Daily-Remaining"] = remainDaily >= 0 ? String(remainDaily) : "unlimited";
  headers["X-Quota-Monthly-Remaining"] = remainMonthly >= 0 ? String(remainMonthly) : "unlimited";

  return {
    allowed: true,
    remaining_daily: Math.max(0, remainDaily),
    remaining_monthly: Math.max(0, remainMonthly),
    degraded_to_heuristic: false,
    headers,
  };
}

/**
 * Record a successful AI inference call.
 * Call AFTER the AI provider returns successfully.
 */
export function recordAiUsage(req: Request): void {
  const ip = extractIp(req);
  const bucket = getBucket(ip);
  bucket.daily++;
  bucket.monthly++;
  globalDaily.count++;
}

/**
 * Get current usage stats (for admin/observability).
 */
export function getUsageStats(): {
  global_daily: number;
  global_daily_limit: number;
  unique_ips_today: number;
  config: QuotaConfig;
} {
  const config = loadConfig();
  // Ensure global is current day
  const dayStart = startOfDay();
  if (globalDaily.reset < dayStart) {
    globalDaily = { count: 0, reset: dayStart };
  }

  let uniqueToday = 0;
  for (const [, bucket] of perIpBuckets) {
    if (bucket.daily_reset >= dayStart && bucket.daily > 0) uniqueToday++;
  }

  return {
    global_daily: globalDaily.count,
    global_daily_limit: config.global_daily_limit,
    unique_ips_today: uniqueToday,
    config,
  };
}

/* ------------------------------------------------------------------ */
/*  Reset (for tests)                                                  */
/* ------------------------------------------------------------------ */

export function _resetForTesting(): void {
  perIpBuckets.clear();
  globalDaily = { count: 0, reset: startOfDay() };
}
