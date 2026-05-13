"use client";

import { useMemo, useState } from "react";
import { useMarketData } from "@/hooks/useMarketData";
import { useStrategy } from "@/hooks/useStrategy";
import { usePurchaserInput } from "@/hooks/usePurchaserInput";
import PriceChart from "@/components/PriceChart";
import MarketMetrics from "@/components/MarketMetrics";
import StrategyResults from "@/components/StrategyResults";
import BasicBrief from "@/components/procurement/BasicBrief";
import AdvancedBrief from "@/components/procurement/AdvancedBrief";
import PresetSelector from "@/components/procurement/PresetSelector";
import InputBriefSummary from "@/components/procurement/InputBriefSummary";
import DocumentationPanel from "@/components/DocumentationPanel";
import { useForecast } from "@/hooks/useForecast";

export default function Home() {
  const { priceData, headlines, loading, error, setError } = useMarketData();
  const bm = priceData?.benchmarks;

  const {
    input,
    advancedMode,
    setAdvancedMode,
    validationErrors,
    updateDemand,
    updateSection,
    applyPreset,
    resetToBasic,
    validate,
  } = usePurchaserInput();

  const {
    forecast,
    marketForecast,
    attribution,
    previousForecasts,
    predictionPerformance,
    forecastLoading,
    fetchForecast,
  } = useForecast(bm?.price_date);

  const { strategy, generating, generateStrategy } = useStrategy({
    priceData,
    headlines,
    landedCost: null,
    marketForecast,
    purchaserInput: input,
    setError,
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [timeframe, setTimeframe] = useState<
    "3M" | "6M" | "1Y" | "3Y" | "5Y" | "ALL"
  >("1Y");
  const displayedPrices = useMemo(() => {
    if (!priceData?.prices?.length) return [];
    const points = priceData.prices;
    const map: Record<Exclude<typeof timeframe, "ALL">, number> = {
      "3M": 63,
      "6M": 126,
      "1Y": 252,
      "3Y": 756,
      "5Y": 1260,
    };
    if (timeframe === "ALL") return points;
    const n = map[timeframe];
    return points.slice(-Math.min(n, points.length));
  }, [priceData, timeframe]);

  const handleGenerate = () => {
    if (advancedMode && !validate()) return;
    generateStrategy();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-zinc-400 mt-4">Loading market data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-tight">
              Cotton Market Intelligence
            </h1>
            <p className="text-xs text-zinc-500">
              Cotton market forecast and procurement timing
            </p>
          </div>
          <div className="flex items-center gap-2">
            <DocumentationPanel />
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="md:hidden p-2 text-zinc-400 hover:text-white"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 flex gap-6">
        {/* Sidebar */}
        <aside
          className={`${
            sidebarOpen ? "block" : "hidden"
          } md:block w-full md:w-72 flex-shrink-0`}
        >
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 sticky top-20 space-y-5 max-h-[calc(100vh-6rem)] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">
                Procurement Brief
              </h2>
              <button
                type="button"
                onClick={() => (advancedMode ? resetToBasic() : setAdvancedMode(true))}
                className="text-[10px] text-blue-400 hover:text-blue-300 font-medium"
              >
                {advancedMode ? "Basic" : "Advanced"}
              </button>
            </div>

            <BasicBrief
              tonnes={input.demand.required_tonnes}
              months={input.demand.planning_horizon_months}
              onTonnesChange={(v) => updateDemand({ required_tonnes: v })}
              onMonthsChange={(v) =>
                updateDemand({ planning_horizon_months: v })
              }
            />

            {advancedMode && (
              <>
                <PresetSelector onSelect={applyPreset} />
                <AdvancedBrief
                  input={input}
                  updateSection={updateSection}
                  updateDemand={updateDemand}
                  validationErrors={validationErrors}
                />
              </>
            )}

            <InputBriefSummary input={input} advancedMode={advancedMode} />

            {validationErrors.length > 0 && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2">
                {validationErrors.map((e, i) => (
                  <p key={i} className="text-[10px] text-red-300">
                    {e.path}: {e.message}
                  </p>
                ))}
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={generating || !priceData}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
            >
              {generating ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Analyzing...
                </span>
              ) : (
                "Generate Strategy"
              )}
            </button>

            {bm && (
              <p className="text-[11px] text-zinc-600">
                Data as of {bm.price_date}
              </p>
            )}
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg p-4 text-sm">
              {error}
            </div>
          )}

          {bm && <MarketMetrics benchmarks={bm} />}

          {/* THE CHART — price + MAs + forecast + backtest, all toggleable */}
          {priceData && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-zinc-500 mr-1 uppercase tracking-wider">
                  Timeframe
                </p>
                {(["3M", "6M", "1Y", "3Y", "5Y", "ALL"] as const).map(
                  (tf) => (
                    <button
                      key={tf}
                      onClick={() => setTimeframe(tf)}
                      className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                        timeframe === tf
                          ? "bg-blue-600/20 border-blue-500 text-blue-300"
                          : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {tf}
                    </button>
                  )
                )}
                {displayedPrices.length > 0 && (
                  <span className="text-xs text-zinc-500 ml-2">
                    {displayedPrices[0].date} to{" "}
                    {displayedPrices[displayedPrices.length - 1].date}
                  </span>
                )}
                <button
                  onClick={fetchForecast}
                  disabled={forecastLoading}
                  className={`ml-auto px-3 py-1 text-xs rounded-md border transition-colors ${
                    forecast
                      ? "bg-purple-600/20 border-purple-500 text-purple-300"
                      : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-zinc-200"
                  } disabled:opacity-50`}
                >
                  {forecastLoading ? "Computing..." : forecast ? "Refresh Forecast" : "Show Forecast"}
                </button>
              </div>
              <PriceChart
                prices={displayedPrices}
                benchmarks={priceData.benchmarks}
                forecast={forecast}
                previousForecasts={previousForecasts}
                predictionPerformance={predictionPerformance}
              />

              {/* How we calculated this — full methodology breakdown */}
              {attribution && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-zinc-200">
                      How We Calculated This Prediction
                    </h4>
                    <span className="text-xs text-zinc-500">
                      {attribution.model_name} | {attribution.model_accuracy}
                    </span>
                  </div>

                  {/* Reasoning summary */}
                  {attribution.reasoning && (
                    <p className="text-sm text-zinc-300 leading-relaxed">
                      {attribution.reasoning}
                    </p>
                  )}

                  {/* Methodology breakdown — signal by signal */}
                  {attribution.methodology && (
                    <div className="space-y-2">
                      <h5 className="text-xs font-semibold text-zinc-400 uppercase">
                        Signal-by-Signal Analysis
                      </h5>
                      {Object.entries(attribution.methodology).map(([category, data]) => {
                        if (!data || typeof data !== "object") return null;
                        const signal = String(data.signal ?? "neutral");
                        const observation = String(data.observation ?? "");
                        const weight = String(data.weight ?? "");
                        if (!observation) return null;
                        return (
                          <div key={category} className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-3">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`w-2 h-2 rounded-full ${
                                signal === "bullish" ? "bg-green-400" :
                                signal === "bearish" ? "bg-red-400" : "bg-zinc-500"
                              }`} />
                              <span className="text-xs font-semibold text-zinc-200 uppercase">
                                {category.replace(/_/g, " ")}
                              </span>
                              <span className={`text-[10px] font-semibold ${
                                signal === "bullish" ? "text-green-400" :
                                signal === "bearish" ? "text-red-400" : "text-zinc-500"
                              }`}>
                                {signal.toUpperCase()}
                              </span>
                              {weight && (
                                <span className="text-[10px] text-zinc-600 ml-auto">{weight}</span>
                              )}
                            </div>
                            <p className="text-xs text-zinc-400">{observation}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Risk */}
                  {attribution.risk && (
                    <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                      <span className="text-xs font-semibold text-red-400">Risk to forecast: </span>
                      <span className="text-xs text-zinc-400">{attribution.risk}</span>
                    </div>
                  )}

                  {/* Key factors */}
                  {attribution.top_features.length > 0 && (
                    <div>
                      <p className="text-[10px] text-zinc-500 mb-1">Key factors:</p>
                      <div className="flex flex-wrap gap-1">
                        {attribution.top_features.map((f, i) => (
                          <span key={i} className="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Strategy results + decision drivers */}
          {strategy ? (
            <StrategyResults
              strategy={strategy}
              headlines={headlines}
              tonnage={input.demand.required_tonnes}
              months={input.demand.planning_horizon_months}
              benchmarks={bm}
              purchaserInput={input}
            />
          ) : (
            !generating && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
                <p className="text-zinc-400">
                  Enter your procurement brief and click{" "}
                  <span className="text-blue-400 font-medium">
                    Generate Strategy
                  </span>{" "}
                  to get started.
                </p>
              </div>
            )
          )}

          {/* Regulatory disclaimers */}
          <div className="border-t border-zinc-800 pt-4 mt-6 space-y-2">
            <p className="text-[10px] text-zinc-600 leading-relaxed">
              This tool provides model-generated cotton market forecasts and procurement timing support. When Hugging Face is configured, Qwen acts as the final analyst layer by ingesting the local model stack, heuristic forecast, sentiment, news, and cross-market evidence before issuing the final view. If hosted AI is unavailable, the app falls back to transparent model/heuristic outputs. It is not investment advice. All recommendations should be validated by qualified professionals before execution. Models can be wrong — past performance does not guarantee future results.
            </p>
            <p className="text-[10px] text-zinc-700">
              Data: Yahoo Finance (delayed), optional FRED | News: RSS (CottonGrower, TextileWorld, USDA, Reuters, ICAC, Fibre2Fashion) | Sentiment: HF DistilRoBERTa | Optional AI context: HF Qwen 2.5 72B | EU AI Act: limited-risk system, transparency obligations met
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
