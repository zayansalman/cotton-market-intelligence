/**
 * Anti-bot and abuse protections for public traffic (#19).
 *
 * Layers on top of rate limiting with:
 * - Suspicious UA / header heuristics
 * - IP denylist / allowlist
 * - Emergency kill-switch
 * - Abuse signal logging
 *
 * All controls are env-configurable and can be toggled without redeploy
 * (Vercel env vars update on next cold start).
 */

import { NextResponse } from "next/server";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface AbuseCheckResult {
  blocked: boolean;
  reason?: string;
  signals: string[];
  score: number; // 0 = clean, higher = more suspicious
}

/* ------------------------------------------------------------------ */
/*  Config from environment                                            */
/* ------------------------------------------------------------------ */

function csvToSet(envKey: string): Set<string> {
  const val = process.env[envKey]?.trim();
  if (!val) return new Set();
  return new Set(val.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

function isKillSwitchOn(): boolean {
  return process.env.API_KILL_SWITCH === "1";
}

function isAbuseProtectionEnabled(): boolean {
  return process.env.ABUSE_PROTECTION_ENABLED !== "0"; // on by default
}

/** Score threshold above which requests are blocked. Default 3. */
function blockThreshold(): number {
  const v = Number(process.env.ABUSE_BLOCK_THRESHOLD);
  return Number.isFinite(v) && v > 0 ? v : 3;
}

/* ------------------------------------------------------------------ */
/*  Suspicious User-Agent patterns                                     */
/* ------------------------------------------------------------------ */

const SUSPICIOUS_UA_PATTERNS = [
  /^$/,                           // empty UA
  /^curl\//i,                     // raw curl (no browser)
  /^python-requests/i,
  /^python-urllib/i,
  /^java\//i,
  /^go-http-client/i,
  /^node-fetch/i,
  /^axios\//i,
  /^wget\//i,
  /^scrapy/i,
  /^httpie/i,
  /^postmanruntime/i,
  /bot|crawl|spider|scrape/i,     // generic bot indicators
];

/** UA patterns that are always allowed (e.g., monitoring probes). */
const ALLOWLISTED_UA_PATTERNS = [
  /^vercel\//i,               // Vercel health checks
  /uptimerobot/i,             // monitoring
  /^github-hookshot/i,        // GitHub webhooks
];

/* ------------------------------------------------------------------ */
/*  Header anomaly detection                                           */
/* ------------------------------------------------------------------ */

function detectHeaderAnomalies(req: Request): string[] {
  const signals: string[] = [];
  const headers = req.headers;

  // Missing or empty user-agent
  const ua = headers.get("user-agent") ?? "";
  if (!ua) {
    signals.push("missing_user_agent");
  }

  // Missing accept header (browsers always send one)
  if (!headers.get("accept")) {
    signals.push("missing_accept_header");
  }

  // Suspicious accept-language (bots often omit this)
  if (!headers.get("accept-language") && ua.length > 0) {
    signals.push("missing_accept_language");
  }

  // Extremely long headers (potential header injection)
  for (const [key, value] of headers.entries()) {
    if (value.length > 8000) {
      signals.push(`oversized_header:${key}`);
    }
  }

  return signals;
}

/* ------------------------------------------------------------------ */
/*  IP extraction (shared with rate-limit.ts)                          */
/* ------------------------------------------------------------------ */

function extractIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim().toLowerCase();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim().toLowerCase();
  return "unknown";
}

/* ------------------------------------------------------------------ */
/*  In-memory tracking for repeat offenders                            */
/* ------------------------------------------------------------------ */

interface OffenderRecord {
  blockCount: number;
  lastSeen: number;
}

const offenders = new Map<string, OffenderRecord>();

function recordBlock(ip: string): void {
  const existing = offenders.get(ip);
  if (existing) {
    existing.blockCount++;
    existing.lastSeen = Date.now();
  } else {
    offenders.set(ip, { blockCount: 1, lastSeen: Date.now() });
  }
}

function getOffenderScore(ip: string): number {
  const record = offenders.get(ip);
  if (!record) return 0;
  // Decay over time — halve weight after 1 hour
  const hoursSinceLastSeen = (Date.now() - record.lastSeen) / (60 * 60 * 1000);
  const decayFactor = Math.pow(0.5, hoursSinceLastSeen);
  return Math.min(record.blockCount * decayFactor, 10);
}

// Prune offenders older than 24 hours
let pruneTimer: ReturnType<typeof setInterval> | null = null;
if (typeof globalThis !== "undefined" && !pruneTimer) {
  pruneTimer = setInterval(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [ip, record] of offenders) {
      if (record.lastSeen < cutoff) offenders.delete(ip);
    }
  }, 30 * 60 * 1000);
  if (pruneTimer.unref) pruneTimer.unref();
}

/* ------------------------------------------------------------------ */
/*  Main check                                                         */
/* ------------------------------------------------------------------ */

/**
 * Run abuse protection checks on an incoming request.
 * Call early in the handler, before rate limiting.
 */
export function checkAbuse(req: Request): AbuseCheckResult {
  // Kill switch — block everything
  if (isKillSwitchOn()) {
    return { blocked: true, reason: "Service temporarily unavailable", signals: ["kill_switch"], score: 99 };
  }

  // Protection disabled — pass through
  if (!isAbuseProtectionEnabled()) {
    return { blocked: false, signals: [], score: 0 };
  }

  const ip = extractIp(req);
  const ua = req.headers.get("user-agent") ?? "";
  const signals: string[] = [];
  let score = 0;

  // Allowlist check — always pass
  const allowlist = csvToSet("ABUSE_IP_ALLOWLIST");
  if (allowlist.has(ip)) {
    return { blocked: false, signals: ["allowlisted"], score: 0 };
  }

  // UA allowlist (monitoring tools, etc.)
  if (ALLOWLISTED_UA_PATTERNS.some((p) => p.test(ua))) {
    return { blocked: false, signals: ["ua_allowlisted"], score: 0 };
  }

  // Denylist check — always block
  const denylist = csvToSet("ABUSE_IP_DENYLIST");
  if (denylist.has(ip)) {
    recordBlock(ip);
    console.warn(`[abuse] Denylisted IP blocked: ${ip}`);
    return { blocked: true, reason: "Forbidden", signals: ["denylisted"], score: 99 };
  }

  // Suspicious UA check
  for (const pattern of SUSPICIOUS_UA_PATTERNS) {
    if (pattern.test(ua)) {
      signals.push(`suspicious_ua:${ua.slice(0, 60)}`);
      score += 2;
      break;
    }
  }

  // Header anomalies
  const headerSignals = detectHeaderAnomalies(req);
  signals.push(...headerSignals);
  score += headerSignals.length;

  // Repeat offender score
  const offenderScore = getOffenderScore(ip);
  if (offenderScore > 0) {
    signals.push(`repeat_offender:${offenderScore.toFixed(1)}`);
    score += offenderScore;
  }

  // Block decision
  const threshold = blockThreshold();
  const blocked = score >= threshold;

  if (blocked) {
    recordBlock(ip);
    console.warn(
      `[abuse] Blocked request — IP: ${ip}, score: ${score}/${threshold}, signals: [${signals.join(", ")}]`
    );
  } else if (signals.length > 0) {
    console.info(
      `[abuse] Suspicious request (allowed) — IP: ${ip}, score: ${score}/${threshold}, signals: [${signals.join(", ")}]`
    );
  }

  return {
    blocked,
    reason: blocked ? "Request blocked by abuse protection" : undefined,
    signals,
    score,
  };
}

/**
 * Returns a 403 response for blocked requests.
 */
export function abuseBlockedResponse(result: AbuseCheckResult): NextResponse {
  return NextResponse.json(
    { error: result.reason ?? "Forbidden" },
    { status: 403 }
  );
}

/* ------------------------------------------------------------------ */
/*  Test helpers                                                       */
/* ------------------------------------------------------------------ */

export function _resetForTesting(): void {
  offenders.clear();
}
