/**
 * Model stack types for V3 forecasting (#25).
 */

export type Horizon = "5d" | "21d" | "63d";

export interface Prediction {
  /** Point forecast — a forward PRICE level (targets are prices, not returns). */
  value: number;
  /** Optional prediction interval. */
  lower?: number;
  upper?: number;
  /** Confidence level for interval (e.g., 0.8 = 80%). */
  confidence_level?: number;
}

export interface ModelMeta {
  id: string;
  name: string;
  type: "baseline" | "statistical" | "ml" | "ensemble";
  description: string;
}

/**
 * All models implement this interface.
 * Pure functions — no external deps, deterministic given same input.
 */
export interface ForecastModel {
  meta: ModelMeta;

  /**
   * Train/fit the model on historical feature rows.
   * Returns model state (serializable) for later prediction.
   */
  fit(
    features: number[][],
    targets: number[],
    featureNames: string[]
  ): ModelState;

  /**
   * Predict using fitted model state.
   *
   * @param currentPrice - Optional current cotton price at the decision date.
   *   Supervised targets are forward PRICE levels (not returns), so random-walk
   *   style baselines use this to predict "the current price persists". Models
   *   that ignore it (regressions, trees) are unaffected — the arg is optional
   *   and backward-compatible.
   */
  predict(
    state: ModelState,
    features: number[],
    currentPrice?: number
  ): Prediction;
}

/** Serializable model state. */
export type ModelState = Record<string, unknown>;

/** Result of training + evaluation on a single horizon. */
export interface ModelResult {
  model_id: string;
  model_name: string;
  horizon: Horizon;
  /** Number of training samples. */
  n_train: number;
  /** Number of test samples. */
  n_test: number;
  /** Mean Absolute Error. */
  mae: number;
  /** Root Mean Squared Error. */
  rmse: number;
  /** Directional accuracy (% of correct up/down calls). */
  direction_accuracy: number;
  /** Mean prediction (for bias check). */
  mean_pred: number;
  /** Mean actual. */
  mean_actual: number;
  /** Model state for deployment. */
  state: ModelState;
}
