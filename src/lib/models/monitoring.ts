/**
 * Production monitoring, drift detection, and retraining triggers (#32).
 *
 * Tracks forecast accuracy over time, detects data/concept drift,
 * and signals when retraining is needed.
 */

import type { Horizon } from "./types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface MonitoringSnapshot {
  date: string;
  horizon: Horizon;
  model_id: string;
  predicted: number;
  actual: number | null; // null until realized
  error: number | null;
}

export interface DriftResult {
  metric: string;
  current_value: number;
  baseline_value: number;
  drift_pct: number;
  is_drifted: boolean;
  threshold_pct: number;
}

export interface RetrainingSignal {
  should_retrain: boolean;
  reasons: string[];
  urgency: "low" | "medium" | "high";
}

export interface MonitoringSummary {
  model_id: string;
  horizon: Horizon;
  /** Rolling MAE over last N realized predictions. */
  rolling_mae: number | null;
  /** Rolling directional accuracy. */
  rolling_direction_accuracy: number | null;
  /** Number of predictions awaiting realization. */
  pending_count: number;
  /** Number of realized predictions. */
  realized_count: number;
  /** Days since last retrain. */
  days_since_retrain: number | null;
  /** Drift checks. */
  drift_checks: DriftResult[];
  /** Retraining recommendation. */
  retraining_signal: RetrainingSignal;
}

/* ------------------------------------------------------------------ */
/*  SLA/SLO definitions                                                */
/* ------------------------------------------------------------------ */

export interface SLO {
  metric: string;
  target: string;
  horizon: Horizon;
  current: string;
  met: boolean;
}

export function defineSLOs(
  rollingMae: number | null,
  rollingDirAcc: number | null,
  staleDays: number,
  horizon: Horizon
): SLO[] {
  const slos: SLO[] = [
    {
      metric: "Prediction freshness",
      target: "< 24 hours",
      horizon,
      current: `${staleDays * 24}h`,
      met: staleDays <= 1,
    },
    {
      metric: "Rolling MAE",
      target: horizon === "5d" ? "< 3%" : horizon === "21d" ? "< 5%" : "< 8%",
      horizon,
      current: rollingMae != null ? `${(rollingMae * 100).toFixed(2)}%` : "N/A",
      met: rollingMae != null
        ? rollingMae < (horizon === "5d" ? 0.03 : horizon === "21d" ? 0.05 : 0.08)
        : false,
    },
    {
      metric: "Direction accuracy",
      target: "> 52%",
      horizon,
      current: rollingDirAcc != null ? `${(rollingDirAcc * 100).toFixed(1)}%` : "N/A",
      met: rollingDirAcc != null ? rollingDirAcc > 0.52 : false,
    },
  ];

  return slos;
}

/* ------------------------------------------------------------------ */
/*  Drift detection                                                    */
/* ------------------------------------------------------------------ */

/**
 * Detect feature drift by comparing recent feature distributions
 * against a baseline. Uses simple mean-shift detection.
 */
export function detectFeatureDrift(
  baselineFeatures: Record<string, number[]>,
  recentFeatures: Record<string, number[]>,
  thresholdPct: number = 20
): DriftResult[] {
  const results: DriftResult[] = [];

  for (const [name, baselineValues] of Object.entries(baselineFeatures)) {
    const recentValues = recentFeatures[name];
    if (!recentValues || recentValues.length === 0 || baselineValues.length === 0) continue;

    const baselineMean = baselineValues.reduce((s, v) => s + v, 0) / baselineValues.length;
    const recentMean = recentValues.reduce((s, v) => s + v, 0) / recentValues.length;

    if (Math.abs(baselineMean) < 1e-10) continue; // Skip near-zero baseline

    const driftPct = Math.abs(
      ((recentMean - baselineMean) / Math.abs(baselineMean)) * 100
    );

    results.push({
      metric: name,
      current_value: Math.round(recentMean * 10000) / 10000,
      baseline_value: Math.round(baselineMean * 10000) / 10000,
      drift_pct: Math.round(driftPct * 100) / 100,
      is_drifted: driftPct > thresholdPct,
      threshold_pct: thresholdPct,
    });
  }

  return results;
}

/**
 * Detect concept drift by comparing recent prediction errors
 * against historical error distribution.
 */
export function detectConceptDrift(
  historicalErrors: number[],
  recentErrors: number[],
  thresholdPct: number = 30
): DriftResult {
  if (historicalErrors.length === 0 || recentErrors.length === 0) {
    return {
      metric: "prediction_error",
      current_value: 0,
      baseline_value: 0,
      drift_pct: 0,
      is_drifted: false,
      threshold_pct: thresholdPct,
    };
  }

  const histMae = historicalErrors.reduce((s, v) => s + Math.abs(v), 0) / historicalErrors.length;
  const recentMae = recentErrors.reduce((s, v) => s + Math.abs(v), 0) / recentErrors.length;

  const driftPct = histMae > 0
    ? Math.abs(((recentMae - histMae) / histMae) * 100)
    : 0;

  return {
    metric: "prediction_error",
    current_value: Math.round(recentMae * 100000) / 100000,
    baseline_value: Math.round(histMae * 100000) / 100000,
    drift_pct: Math.round(driftPct * 100) / 100,
    is_drifted: driftPct > thresholdPct,
    threshold_pct: thresholdPct,
  };
}

/* ------------------------------------------------------------------ */
/*  Retraining trigger                                                 */
/* ------------------------------------------------------------------ */

export function evaluateRetrainingNeed(opts: {
  daysSinceRetrain: number;
  conceptDrift: DriftResult;
  featureDrifts: DriftResult[];
  rollingMae: number | null;
  maeThreshold: number;
}): RetrainingSignal {
  const reasons: string[] = [];
  let urgency: "low" | "medium" | "high" = "low";

  // Time-based trigger
  if (opts.daysSinceRetrain > 30) {
    reasons.push(`${opts.daysSinceRetrain} days since last retrain (max 30)`);
    urgency = "medium";
  }

  // Concept drift trigger
  if (opts.conceptDrift.is_drifted) {
    reasons.push(`Concept drift detected: error increased ${opts.conceptDrift.drift_pct}%`);
    urgency = "high";
  }

  // Feature drift trigger (>3 drifted features)
  const driftedFeatures = opts.featureDrifts.filter((d) => d.is_drifted);
  if (driftedFeatures.length >= 3) {
    reasons.push(
      `${driftedFeatures.length} features drifted: ${driftedFeatures
        .slice(0, 3)
        .map((d) => d.metric)
        .join(", ")}`
    );
    if (urgency === "low") urgency = "medium";
  }

  // Accuracy degradation trigger
  if (opts.rollingMae != null && opts.rollingMae > opts.maeThreshold) {
    reasons.push(
      `Rolling MAE (${(opts.rollingMae * 100).toFixed(2)}%) exceeds threshold (${(opts.maeThreshold * 100).toFixed(0)}%)`
    );
    urgency = "high";
  }

  return {
    should_retrain: reasons.length > 0,
    reasons,
    urgency,
  };
}
