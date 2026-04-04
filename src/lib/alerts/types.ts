/**
 * Alerting types (#8).
 */

import type { Benchmarks, Strategy } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Alert rules                                                        */
/* ------------------------------------------------------------------ */

export type AlertTrigger =
  | "signal_change"       // Signal transitions (e.g., HOLD → BUY)
  | "volatility_breach"   // Vol exceeds threshold
  | "key_level_break"     // Price breaks support or resistance
  | "price_threshold";    // Price crosses user-defined level

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AlertTrigger;
  /** Trigger-specific config. */
  config: AlertRuleConfig;
  /** Delivery channels for this rule. */
  channels: AlertChannel[];
}

export type AlertRuleConfig =
  | { type: "signal_change" }
  | { type: "volatility_breach"; threshold_pct: number }
  | { type: "key_level_break" }
  | { type: "price_threshold"; direction: "above" | "below"; price: number };

/* ------------------------------------------------------------------ */
/*  Delivery channels                                                  */
/* ------------------------------------------------------------------ */

export type AlertChannelType = "webhook" | "email";

export interface WebhookChannel {
  type: "webhook";
  url: string;
  /** Optional custom headers (e.g., Slack bot token). */
  headers?: Record<string, string>;
}

export interface EmailChannel {
  type: "email";
  to: string;
}

export type AlertChannel = WebhookChannel | EmailChannel;

/* ------------------------------------------------------------------ */
/*  Alert payload                                                      */
/* ------------------------------------------------------------------ */

export interface AlertPayload {
  rule_id: string;
  rule_name: string;
  trigger: AlertTrigger;
  fired_at: string;
  signal: Strategy["signal"];
  confidence: number;
  price: number;
  price_date: string;
  vol_30d: number;
  pct_rank_1y: number;
  message: string;
  recommended_action: string;
  /** Previous signal (for signal_change triggers). */
  previous_signal?: Strategy["signal"];
}

/* ------------------------------------------------------------------ */
/*  Alert state (for tracking previous values)                         */
/* ------------------------------------------------------------------ */

export interface AlertState {
  last_signal?: Strategy["signal"];
  last_price?: number;
  last_checked?: string;
}
