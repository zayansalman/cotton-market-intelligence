"use client";

import { useState, useCallback } from "react";
import type { ForecastOverlayData, ForecastPoint } from "@/components/PriceChart";

interface PredictionForecast {
  horizon: string;
  predicted_return: number;
  predicted_price: number;
  lower_price: number;
  upper_price: number;
  direction: "up" | "down" | "flat";
}

interface PredictionResponse {
  current_price: number;
  current_date: string;
  forecasts: PredictionForecast[];
  model: { name: string };
  hf_forecasts?: { provider: string; predicted_price: number; direction: string }[];
}

/**
 * Generates future business dates from a start date.
 */
function futureDates(startDate: string, count: number): string[] {
  const dates: string[] = [];
  const d = new Date(startDate);
  while (dates.length < count) {
    d.setDate(d.getDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(d.toISOString().slice(0, 10));
    }
  }
  return dates;
}

export function useForecast() {
  const [forecast, setForecast] = useState<ForecastOverlayData | undefined>();
  const [loading, setLoading] = useState(false);

  const fetchForecast = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/prediction?horizon=21d");
      if (!res.ok) throw new Error("Prediction failed");
      const data: PredictionResponse = await res.json();

      // Build forecast points for each horizon
      const horizonDays: Record<string, number> = { "5d": 5, "21d": 21, "63d": 63 };
      const points: ForecastPoint[] = [];

      // Use the 21d forecast as the primary overlay
      const primary = data.forecasts.find((f) => f.horizon === "21d") ?? data.forecasts[0];
      if (!primary) return;

      const dates = futureDates(data.current_date, horizonDays[primary.horizon] ?? 21);

      // Interpolate from current price to forecast price
      const startPrice = data.current_price;
      const endPrice = primary.predicted_price;
      const endLower = primary.lower_price;
      const endUpper = primary.upper_price;

      for (let i = 0; i < dates.length; i++) {
        const t = (i + 1) / dates.length; // 0 to 1
        points.push({
          date: dates[i],
          predicted_price: Math.round((startPrice + (endPrice - startPrice) * t) * 10000) / 10000,
          lower_price: Math.round((startPrice + (endLower - startPrice) * t) * 10000) / 10000,
          upper_price: Math.round((startPrice + (endUpper - startPrice) * t) * 10000) / 10000,
          horizon: primary.horizon,
        });
      }

      // Determine dominant direction
      const direction = primary.direction;

      setForecast({
        points,
        model_name: data.model.name,
        direction,
      });
    } catch (e) {
      console.error("Forecast fetch failed:", e);
      setForecast(undefined);
    } finally {
      setLoading(false);
    }
  }, []);

  return { forecast, forecastLoading: loading, fetchForecast };
}
