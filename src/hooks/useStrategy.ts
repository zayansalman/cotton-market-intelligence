"use client";

import { useState, useCallback } from "react";
import type {
  PricesResponse,
  Headline,
  Strategy,
  LandedCostResponse,
  PurchaserInput,
  Benchmarks,
} from "@/lib/types";

interface UseStrategyDeps {
  priceData: PricesResponse | null;
  headlines: Headline[];
  landedCost: LandedCostResponse | null;
  marketForecast?: unknown | null;
  purchaserInput: PurchaserInput;
  setError: (msg: string | null) => void;
}

export interface StrategyRequestBody {
  strategy_input_version: 2;
  purchaser_input: PurchaserInput;
  benchmarks: Benchmarks;
  headlines: Headline[];
  landedCost?: LandedCostResponse;
  marketForecast?: unknown;
}

/**
 * Distribute `total` whole units across buckets proportional to `weights`,
 * guaranteeing the result sums to exactly `total` (largest-remainder /
 * Hamilton apportionment). Prevents rounded tonnes/pct from drifting off
 * the required tonnage or 100%.
 */
export function largestRemainder(weights: number[], total: number): number[] {
  const sum = weights.reduce((s, w) => s + (w > 0 ? w : 0), 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => ((w > 0 ? w : 0) / sum) * total);
  const floors = raw.map((r) => Math.floor(r));
  let remainder = total - floors.reduce((s, v) => s + v, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  const result = [...floors];
  for (let k = 0; k < order.length && remainder > 0; k += 1) {
    result[order[k].i] += 1;
    remainder -= 1;
  }
  return result;
}

async function readStrategyError(res: Response): Promise<string> {
  if (res.status === 429) {
    return "Rate limit reached — please wait a moment and try again.";
  }
  try {
    const body = (await res.json()) as {
      error?: string;
      errors?: Array<{ field?: string; reason?: string }>;
    };
    if (body?.errors?.length) {
      return body.errors
        .map((e) => [e.field, e.reason].filter(Boolean).join(": "))
        .filter(Boolean)
        .join("; ");
    }
    if (body?.error) return body.error;
  } catch {
    /* fall through to generic message */
  }
  return `Strategy generation failed (HTTP ${res.status}).`;
}

export function buildStrategyRequestBody({
  benchmarks,
  headlines,
  landedCost,
  marketForecast,
  purchaserInput,
}: {
  benchmarks: Benchmarks;
  headlines: Headline[];
  landedCost: LandedCostResponse | null;
  marketForecast?: unknown | null;
  purchaserInput: PurchaserInput;
}): StrategyRequestBody {
  return {
    strategy_input_version: 2,
    purchaser_input: purchaserInput,
    benchmarks,
    headlines,
    ...(landedCost ? { landedCost } : {}),
    ...(marketForecast ? { marketForecast } : {}),
  };
}

export function useStrategy({
  priceData,
  headlines,
  landedCost,
  marketForecast: cachedMarketForecast,
  purchaserInput,
  setError,
}: UseStrategyDeps) {
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [generating, setGenerating] = useState(false);
  // Snapshot of the purchaser input that produced `strategy`, so the results
  // header stays consistent with the plan even after the user edits the form.
  const [generatedInput, setGeneratedInput] = useState<PurchaserInput | null>(
    null
  );

  const generateStrategy = useCallback(async () => {
    if (!priceData) return;
    setGenerating(true);
    setError(null);
    try {
      const marketForecast =
        cachedMarketForecast ??
        (await fetch("/api/prediction?horizon=21d")
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null));
      const body = buildStrategyRequestBody({
        benchmarks: priceData.benchmarks,
        headlines,
        landedCost,
        marketForecast,
        purchaserInput,
      });
      const res = await fetch("/api/strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data: Strategy = await res.json();
        const totalPct = data.monthly_plan.reduce((s, p) => s + p.pct, 0);
        const tonnage = purchaserInput.demand.required_tonnes;
        // The engine (heuristic path) already produces authoritative monthly
        // tonnes — which may be intentionally capped BELOW the required total
        // when receipt capacity cannot absorb the volume. Trust those: round
        // them to sum to the engine's total (never re-inflate past the cap)
        // and derive pct FROM tonnes so the two are internally consistent.
        // Only the AI path returns pct without tonnes; there we apportion the
        // required tonnage by pct.
        const hasEngineTonnes = data.monthly_plan.every(
          (p) => typeof p.tonnes === "number" && Number.isFinite(p.tonnes)
        );
        if (hasEngineTonnes) {
          const tonnesRaw = data.monthly_plan.map((p) => p.tonnes);
          const total = tonnesRaw.reduce((s, v) => s + v, 0);
          const tonnesAlloc = largestRemainder(tonnesRaw, Math.round(total));
          const pctTenths = largestRemainder(tonnesRaw, 1000);
          data.monthly_plan = data.monthly_plan.map((p, i) => ({
            ...p,
            pct: total > 0 ? pctTenths[i] / 10 : p.pct,
            tonnes: tonnesAlloc[i],
          }));
        } else if (totalPct > 0) {
          const weights = data.monthly_plan.map((p) => p.pct);
          // Apportion so tonnes sum to exactly the required tonnage and pct
          // (in tenths) sums to exactly 100.0.
          const tonnesAlloc = largestRemainder(weights, Math.round(tonnage));
          const pctTenths = largestRemainder(weights, 1000);
          data.monthly_plan = data.monthly_plan.map((p, i) => ({
            ...p,
            pct: pctTenths[i] / 10,
            tonnes: tonnesAlloc[i],
          }));
        }
        setStrategy(data);
        setGeneratedInput(purchaserInput);
      } else {
        setError(await readStrategyError(res));
      }
    } catch {
      setError("Strategy generation failed.");
    } finally {
      setGenerating(false);
    }
  }, [priceData, headlines, landedCost, cachedMarketForecast, purchaserInput, setError]);

  return { strategy, generating, generateStrategy, generatedInput };
}
