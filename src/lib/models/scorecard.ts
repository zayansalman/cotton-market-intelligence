/**
 * Accuracy scorecard and model rating (#31).
 *
 * Evaluates model quality and assigns a traffic-light rating
 * (green/yellow/red) based on defined thresholds.
 */

import type { Horizon } from "./types";
import type { WalkForwardResult, WalkForwardMetrics } from "./walk-forward";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type Rating = "green" | "yellow" | "red";

export interface HorizonScore {
  horizon: Horizon;
  model_id: string;
  model_name: string;
  metrics: WalkForwardMetrics;
  beats_naive: boolean;
  naive_rmse: number;
  improvement_pct: number;
  rating: Rating;
  rating_rationale: string;
}

export interface Scorecard {
  generated_at: string;
  champion_model: string;
  overall_rating: Rating;
  overall_rationale: string;
  production_ready: boolean;
  horizons: HorizonScore[];
  go_nogo_criteria: GoNoGoCriterion[];
}

export interface GoNoGoCriterion {
  criterion: string;
  required: string;
  actual: string;
  passed: boolean;
}

/* ------------------------------------------------------------------ */
/*  Thresholds                                                         */
/* ------------------------------------------------------------------ */

interface Thresholds {
  /** Must beat naive RMSE by at least this %. */
  min_improvement_pct: number;
  /** Minimum directional accuracy. */
  min_direction_accuracy: number;
  /** Maximum acceptable MAPE. */
  max_mape: number;
  /** Minimum walk-forward steps for validity. */
  min_steps: number;
}

const THRESHOLDS: Record<Horizon, Thresholds> = {
  "5d": {
    min_improvement_pct: 5,
    min_direction_accuracy: 0.52,
    max_mape: 200,
    min_steps: 20,
  },
  "21d": {
    min_improvement_pct: 5,
    min_direction_accuracy: 0.53,
    max_mape: 150,
    min_steps: 15,
  },
  "63d": {
    min_improvement_pct: 5,
    min_direction_accuracy: 0.55,
    max_mape: 120,
    min_steps: 10,
  },
};

/* ------------------------------------------------------------------ */
/*  Rating logic                                                       */
/* ------------------------------------------------------------------ */

function rateHorizon(
  champion: WalkForwardResult,
  naive: WalkForwardResult,
  horizon: Horizon
): HorizonScore {
  const t = THRESHOLDS[horizon];
  const cm = champion.metrics;
  const nm = naive.metrics;

  const improvementPct =
    nm.rmse > 0
      ? Math.round(((nm.rmse - cm.rmse) / nm.rmse) * 10000) / 100
      : 0;

  const beatsNaive = cm.rmse < nm.rmse;

  let rating: Rating;
  let rationale: string;

  if (
    beatsNaive &&
    improvementPct >= t.min_improvement_pct &&
    cm.direction_accuracy >= t.min_direction_accuracy &&
    cm.n_steps >= t.min_steps
  ) {
    rating = "green";
    rationale = `Beats naive by ${improvementPct}%, direction accuracy ${(cm.direction_accuracy * 100).toFixed(1)}%`;
  } else if (
    beatsNaive &&
    cm.direction_accuracy >= 0.50 &&
    cm.n_steps >= t.min_steps
  ) {
    rating = "yellow";
    rationale = `Beats naive but improvement (${improvementPct}%) or direction accuracy (${(cm.direction_accuracy * 100).toFixed(1)}%) below target`;
  } else {
    rating = "red";
    rationale = beatsNaive
      ? `Insufficient data (${cm.n_steps} steps) or metrics below threshold`
      : `Does not beat naive baseline (RMSE ${cm.rmse} vs ${nm.rmse})`;
  }

  return {
    horizon,
    model_id: champion.model_id,
    model_name: champion.model_name,
    metrics: cm,
    beats_naive: beatsNaive,
    naive_rmse: nm.rmse,
    improvement_pct: improvementPct,
    rating,
    rating_rationale: rationale,
  };
}

/* ------------------------------------------------------------------ */
/*  Generate scorecard                                                 */
/* ------------------------------------------------------------------ */

/**
 * Generate a full accuracy scorecard from walk-forward results.
 *
 * @param resultsByHorizon - Map of horizon → array of WalkForwardResult (one per model)
 */
export function generateScorecard(
  resultsByHorizon: Record<Horizon, WalkForwardResult[]>
): Scorecard {
  const horizonScores: HorizonScore[] = [];

  for (const horizon of ["5d", "21d", "63d"] as Horizon[]) {
    const results = resultsByHorizon[horizon];
    if (!results || results.length === 0) continue;

    const naive = results.find((r) => r.model_id === "naive");
    if (!naive) continue;

    // Find best non-baseline model by RMSE
    const nonBaseline = results.filter(
      (r) => !["naive", "hist_mean", "ma_return", "seasonal_naive"].includes(r.model_id)
    );
    const champion = nonBaseline.length > 0
      ? nonBaseline.sort((a, b) => a.metrics.rmse - b.metrics.rmse)[0]
      : naive;

    horizonScores.push(rateHorizon(champion, naive, horizon));
  }

  // Overall rating: worst of all horizons
  const ratings = horizonScores.map((s) => s.rating);
  const overallRating: Rating = ratings.includes("red")
    ? "red"
    : ratings.includes("yellow")
      ? "yellow"
      : "green";

  const championModel = horizonScores.length > 0
    ? horizonScores[0].model_id
    : "naive";

  // Go/no-go criteria
  const criteria: GoNoGoCriterion[] = [
    {
      criterion: "At least one horizon rated green",
      required: "true",
      actual: String(ratings.includes("green")),
      passed: ratings.includes("green"),
    },
    {
      criterion: "No horizon rated red",
      required: "true",
      actual: String(!ratings.includes("red")),
      passed: !ratings.includes("red"),
    },
    {
      criterion: "21d horizon beats naive",
      required: "true",
      actual: String(horizonScores.find((s) => s.horizon === "21d")?.beats_naive ?? false),
      passed: horizonScores.find((s) => s.horizon === "21d")?.beats_naive ?? false,
    },
    {
      criterion: "All horizons have minimum steps",
      required: "true",
      actual: String(horizonScores.every((s) => s.metrics.n_steps >= THRESHOLDS[s.horizon].min_steps)),
      passed: horizonScores.every((s) => s.metrics.n_steps >= THRESHOLDS[s.horizon].min_steps),
    },
  ];

  const productionReady = criteria.every((c) => c.passed);

  return {
    generated_at: new Date().toISOString(),
    champion_model: championModel,
    overall_rating: overallRating,
    overall_rationale:
      overallRating === "green"
        ? "All horizons meet production thresholds"
        : overallRating === "yellow"
          ? "Some horizons below target — monitor closely"
          : "Model quality insufficient for production",
    production_ready: productionReady,
    horizons: horizonScores,
    go_nogo_criteria: criteria,
  };
}
