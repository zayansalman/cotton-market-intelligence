/**
 * Alert rule evaluation engine (#8).
 *
 * Evaluates rules against current market state and previous state
 * to detect trigger conditions. Pure functions — no side effects.
 */

import type {
  AlertRule,
  AlertPayload,
  AlertState,
  AlertRuleConfig,
} from "./types";
import type { Benchmarks, Strategy } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Evaluate a single rule                                             */
/* ------------------------------------------------------------------ */

export function evaluateRule(
  rule: AlertRule,
  benchmarks: Benchmarks,
  strategy: Strategy,
  state: AlertState
): AlertPayload | null {
  if (!rule.enabled) return null;

  const config = rule.config;

  switch (config.type) {
    case "signal_change":
      return evaluateSignalChange(rule, strategy, state, benchmarks);
    case "volatility_breach":
      return evaluateVolBreach(rule, config, benchmarks, strategy);
    case "key_level_break":
      return evaluateKeyLevelBreak(rule, benchmarks, strategy, state);
    case "price_threshold":
      return evaluatePriceThreshold(rule, config, benchmarks, strategy, state);
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Trigger evaluators                                                 */
/* ------------------------------------------------------------------ */

function evaluateSignalChange(
  rule: AlertRule,
  strategy: Strategy,
  state: AlertState,
  bm: Benchmarks
): AlertPayload | null {
  if (!state.last_signal) return null; // No previous signal to compare
  if (state.last_signal === strategy.signal) return null; // No change

  return buildPayload(rule, bm, strategy, {
    message: `Signal changed from ${state.last_signal} to ${strategy.signal}`,
    recommended_action: signalAction(strategy.signal),
    previous_signal: state.last_signal,
  });
}

function evaluateVolBreach(
  rule: AlertRule,
  config: { type: "volatility_breach"; threshold_pct: number },
  bm: Benchmarks,
  strategy: Strategy
): AlertPayload | null {
  if (bm.vol_30d_ann < config.threshold_pct) return null;

  return buildPayload(rule, bm, strategy, {
    message: `30d volatility at ${bm.vol_30d_ann.toFixed(1)}% exceeds ${config.threshold_pct}% threshold`,
    recommended_action:
      "Spread procurement over more months to reduce execution risk. Consider hedging.",
  });
}

function evaluateKeyLevelBreak(
  rule: AlertRule,
  bm: Benchmarks,
  strategy: Strategy,
  state: AlertState
): AlertPayload | null {
  if (!state.last_price || !strategy.key_levels) return null;

  const { support, resistance } = strategy.key_levels;
  const prev = state.last_price;
  const curr = bm.current_price;

  // Break below support
  if (prev >= support && curr < support) {
    return buildPayload(rule, bm, strategy, {
      message: `Price broke below support at $${support.toFixed(4)}/lb`,
      recommended_action:
        "Support broken — consider accelerating procurement if fundamentals support.",
    });
  }

  // Break above resistance
  if (prev <= resistance && curr > resistance) {
    return buildPayload(rule, bm, strategy, {
      message: `Price broke above resistance at $${resistance.toFixed(4)}/lb`,
      recommended_action:
        "Resistance broken — consider deferring non-urgent purchases.",
    });
  }

  return null;
}

function evaluatePriceThreshold(
  rule: AlertRule,
  config: { type: "price_threshold"; direction: "above" | "below"; price: number },
  bm: Benchmarks,
  strategy: Strategy,
  state: AlertState
): AlertPayload | null {
  if (!state.last_price) return null;

  const prev = state.last_price;
  const curr = bm.current_price;

  if (config.direction === "above" && prev <= config.price && curr > config.price) {
    return buildPayload(rule, bm, strategy, {
      message: `Price crossed above $${config.price.toFixed(4)}/lb`,
      recommended_action: "Price above target — review procurement timing.",
    });
  }

  if (config.direction === "below" && prev >= config.price && curr < config.price) {
    return buildPayload(rule, bm, strategy, {
      message: `Price crossed below $${config.price.toFixed(4)}/lb`,
      recommended_action: "Price below target — opportunity to accelerate buying.",
    });
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function signalAction(signal: Strategy["signal"]): string {
  switch (signal) {
    case "STRONG_BUY":
      return "Aggressive front-loading recommended. Secure inventory immediately.";
    case "BUY":
      return "Increase procurement pacing. Good entry opportunity.";
    case "HOLD":
      return "Maintain baseline cadence. No urgency to change.";
    case "AVOID":
      return "Defer non-essential purchases. Wait for better entry.";
  }
}

function buildPayload(
  rule: AlertRule,
  bm: Benchmarks,
  strategy: Strategy,
  extra: {
    message: string;
    recommended_action: string;
    previous_signal?: Strategy["signal"];
  }
): AlertPayload {
  return {
    rule_id: rule.id,
    rule_name: rule.name,
    trigger: rule.trigger,
    fired_at: new Date().toISOString(),
    signal: strategy.signal,
    confidence: strategy.confidence,
    price: bm.current_price,
    price_date: bm.price_date,
    vol_30d: bm.vol_30d_ann,
    pct_rank_1y: bm.pct_rank_1y,
    ...extra,
  };
}

/* ------------------------------------------------------------------ */
/*  Evaluate all rules                                                 */
/* ------------------------------------------------------------------ */

/**
 * Evaluate all enabled rules against current state.
 * Returns fired alerts (may be empty).
 */
export function evaluateAllRules(
  rules: AlertRule[],
  benchmarks: Benchmarks,
  strategy: Strategy,
  state: AlertState
): AlertPayload[] {
  const alerts: AlertPayload[] = [];
  for (const rule of rules) {
    const result = evaluateRule(rule, benchmarks, strategy, state);
    if (result) alerts.push(result);
  }
  return alerts;
}

/**
 * Update alert state after evaluation.
 */
export function updateAlertState(
  state: AlertState,
  benchmarks: Benchmarks,
  strategy: Strategy
): AlertState {
  return {
    last_signal: strategy.signal,
    last_price: benchmarks.current_price,
    last_checked: new Date().toISOString(),
  };
}
