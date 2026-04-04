/**
 * Alert engine tests (#8).
 */

import { describe, it, expect } from "vitest";
import { evaluateRule, evaluateAllRules, updateAlertState } from "../engine";
import type { AlertRule, AlertState } from "../types";
import type { Benchmarks, Strategy } from "@/lib/types";

const baseBm: Benchmarks = {
  current_price: 0.72,
  price_date: "2026-04-04",
  change_30d_pct: -2.1,
  change_90d_pct: 5.3,
  pct_rank_1y: 0.45,
  pct_rank_5y: 0.38,
  z_score_1y: -0.5,
  vol_30d_ann: 22.5,
  vol_90d_ann: 25.1,
  ma_50d: 0.73,
  ma_200d: 0.71,
  above_ma_50d: false,
  above_ma_200d: true,
  high_1y: 0.85,
  low_1y: 0.62,
};

const baseStrategy: Strategy = {
  signal: "BUY",
  confidence: 65,
  executive_summary: "Test",
  market_analysis: "Test",
  monthly_plan: [],
  risk_factors: [],
  next_actions: [],
  key_levels: { support: 0.65, resistance: 0.82, fair_value: 0.72 },
  source: "heuristic",
  provider: "heuristic",
};

describe("signal_change trigger", () => {
  const rule: AlertRule = {
    id: "r1",
    name: "Signal Change",
    enabled: true,
    trigger: "signal_change",
    config: { type: "signal_change" },
    channels: [],
  };

  it("fires when signal changes", () => {
    const state: AlertState = { last_signal: "HOLD", last_price: 0.72 };
    const result = evaluateRule(rule, baseBm, baseStrategy, state);
    expect(result).not.toBeNull();
    expect(result!.message).toContain("HOLD");
    expect(result!.message).toContain("BUY");
    expect(result!.previous_signal).toBe("HOLD");
  });

  it("does not fire when signal unchanged", () => {
    const state: AlertState = { last_signal: "BUY", last_price: 0.72 };
    const result = evaluateRule(rule, baseBm, baseStrategy, state);
    expect(result).toBeNull();
  });

  it("does not fire without previous signal", () => {
    const result = evaluateRule(rule, baseBm, baseStrategy, {});
    expect(result).toBeNull();
  });
});

describe("volatility_breach trigger", () => {
  const rule: AlertRule = {
    id: "r2",
    name: "Vol Spike",
    enabled: true,
    trigger: "volatility_breach",
    config: { type: "volatility_breach", threshold_pct: 20 },
    channels: [],
  };

  it("fires when vol exceeds threshold", () => {
    const result = evaluateRule(rule, baseBm, baseStrategy, {});
    expect(result).not.toBeNull();
    expect(result!.message).toContain("22.5%");
  });

  it("does not fire below threshold", () => {
    const rule30: AlertRule = {
      ...rule,
      config: { type: "volatility_breach", threshold_pct: 30 },
    };
    const result = evaluateRule(rule30, baseBm, baseStrategy, {});
    expect(result).toBeNull();
  });
});

describe("key_level_break trigger", () => {
  const rule: AlertRule = {
    id: "r3",
    name: "Level Break",
    enabled: true,
    trigger: "key_level_break",
    config: { type: "key_level_break" },
    channels: [],
  };

  it("fires on support break", () => {
    const state: AlertState = { last_price: 0.66, last_signal: "BUY" };
    const bm = { ...baseBm, current_price: 0.64 }; // below support 0.65
    const result = evaluateRule(rule, bm, baseStrategy, state);
    expect(result).not.toBeNull();
    expect(result!.message).toContain("support");
  });

  it("fires on resistance break", () => {
    const state: AlertState = { last_price: 0.81, last_signal: "BUY" };
    const bm = { ...baseBm, current_price: 0.83 }; // above resistance 0.82
    const result = evaluateRule(rule, bm, baseStrategy, state);
    expect(result).not.toBeNull();
    expect(result!.message).toContain("resistance");
  });

  it("does not fire when price stays between levels", () => {
    const state: AlertState = { last_price: 0.70, last_signal: "BUY" };
    const result = evaluateRule(rule, baseBm, baseStrategy, state);
    expect(result).toBeNull();
  });
});

describe("price_threshold trigger", () => {
  const rule: AlertRule = {
    id: "r4",
    name: "Price Below 0.70",
    enabled: true,
    trigger: "price_threshold",
    config: { type: "price_threshold", direction: "below", price: 0.70 },
    channels: [],
  };

  it("fires when price crosses below threshold", () => {
    const state: AlertState = { last_price: 0.71, last_signal: "BUY" };
    const bm = { ...baseBm, current_price: 0.69 };
    const result = evaluateRule(rule, bm, baseStrategy, state);
    expect(result).not.toBeNull();
    expect(result!.message).toContain("below");
  });

  it("does not fire when price stays above", () => {
    const state: AlertState = { last_price: 0.73, last_signal: "BUY" };
    const result = evaluateRule(rule, baseBm, baseStrategy, state);
    expect(result).toBeNull();
  });
});

describe("evaluateAllRules", () => {
  it("returns only fired alerts", () => {
    const rules: AlertRule[] = [
      {
        id: "r1",
        name: "Signal Change",
        enabled: true,
        trigger: "signal_change",
        config: { type: "signal_change" },
        channels: [],
      },
      {
        id: "r2",
        name: "Vol High",
        enabled: true,
        trigger: "volatility_breach",
        config: { type: "volatility_breach", threshold_pct: 20 },
        channels: [],
      },
    ];

    const state: AlertState = { last_signal: "HOLD", last_price: 0.72 };
    const results = evaluateAllRules(rules, baseBm, baseStrategy, state);
    expect(results).toHaveLength(2); // both should fire
  });

  it("skips disabled rules", () => {
    const rules: AlertRule[] = [
      {
        id: "r1",
        name: "Disabled",
        enabled: false,
        trigger: "signal_change",
        config: { type: "signal_change" },
        channels: [],
      },
    ];

    const state: AlertState = { last_signal: "HOLD" };
    const results = evaluateAllRules(rules, baseBm, baseStrategy, state);
    expect(results).toHaveLength(0);
  });
});

describe("updateAlertState", () => {
  it("captures current signal and price", () => {
    const newState = updateAlertState({}, baseBm, baseStrategy);
    expect(newState.last_signal).toBe("BUY");
    expect(newState.last_price).toBe(0.72);
    expect(newState.last_checked).toBeDefined();
  });
});
