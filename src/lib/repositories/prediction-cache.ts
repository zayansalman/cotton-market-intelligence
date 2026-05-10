import type { SupabaseClient } from "@supabase/supabase-js";
import type { Horizon } from "../models/types";
import {
  isPredictionResponseFor,
  type PredictionCache,
  type PredictionCacheWrite,
} from "../services/prediction-service";

type SupabasePredictionClient = Pick<SupabaseClient, "from">;

export function createSupabasePredictionCache(
  supabase: SupabasePredictionClient
): PredictionCache {
  return {
    async read(currentDate: string, horizon: Horizon) {
      try {
        const { data, error } = await supabase
          .from("predictions")
          .select("response_payload")
          .eq("prediction_date", currentDate)
          .eq("horizon", horizon)
          .not("response_payload", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error || !data) return null;
        const payload = (data as { response_payload?: unknown }).response_payload;
        return isPredictionResponseFor(payload, currentDate, horizon)
          ? payload
          : null;
      } catch {
        return null;
      }
    },

    async write({ response, forecast, targetDate, forecastPoints }: PredictionCacheWrite) {
      try {
        await supabase.from("predictions").upsert(
          {
            prediction_date: response.current_date,
            current_price: response.current_price,
            horizon: forecast.horizon,
            target_date: targetDate,
            predicted_price: forecast.predicted_price,
            lower_price: forecast.lower_price,
            upper_price: forecast.upper_price,
            forecast_points: forecastPoints,
            direction: forecast.direction,
            confidence: response.confidence,
            model_id: response.model.id,
            model_name: response.model.name,
            reasoning: response.reasoning || null,
            response_payload: response,
          },
          { onConflict: "prediction_date,horizon,model_id" }
        );
      } catch {
        // Cache writes must never break prediction generation.
      }
    },
  };
}
