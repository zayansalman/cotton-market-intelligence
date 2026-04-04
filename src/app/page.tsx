"use client";

import { useMemo, useState } from "react";
import { useMarketData } from "@/hooks/useMarketData";
import { useLandedCost } from "@/hooks/useLandedCost";
import { useStrategy } from "@/hooks/useStrategy";
import { usePurchaserInput } from "@/hooks/usePurchaserInput";
import PriceChart from "@/components/PriceChart";
import LandedCostCard from "@/components/LandedCostCard";
import MarketMetrics from "@/components/MarketMetrics";
import StrategyResults from "@/components/StrategyResults";
import BasicBrief from "@/components/procurement/BasicBrief";
import AdvancedBrief from "@/components/procurement/AdvancedBrief";
import PresetSelector from "@/components/procurement/PresetSelector";
import InputBriefSummary from "@/components/procurement/InputBriefSummary";
import ScenarioManager from "@/components/scenarios/ScenarioManager";
import ScenarioCompare from "@/components/scenarios/ScenarioCompare";
import { useScenarios } from "@/hooks/useScenarios";
import { getScenario } from "@/lib/scenarios/store";

export default function Home() {
  const { priceData, headlines, loading, error, setError } = useMarketData();
  const bm = priceData?.benchmarks;

  const {
    landedCost,
    landedCostLoading,
    basisCentsLb,
    setBasisCentsLb,
    freightUsdT,
    setFreightUsdT,
    fxBdtUsd,
    setFxBdtUsd,
  } = useLandedCost(bm);

  const {
    input,
    setInput,
    advancedMode,
    setAdvancedMode,
    validationErrors,
    updateDemand,
    updateSection,
    applyPreset,
    resetToBasic,
    validate,
  } = usePurchaserInput();

  const { strategy, generating, generateStrategy } = useStrategy({
    priceData,
    headlines,
    landedCost,
    purchaserInput: input,
    setError,
  });

  const {
    scenarios,
    save: saveScenario,
    remove: removeScenario,
    rename: renameScenarioFn,
    duplicate: duplicateScenario,
    doExport: exportScenario,
    doImport: importScenario,
    compareIds,
    setCompareIds,
  } = useScenarios();

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
              AI procurement advisor for spinning mills
            </p>
          </div>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden p-2 text-zinc-400 hover:text-white"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
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

            {/* Core fields (always visible) */}
            <BasicBrief
              tonnes={input.demand.required_tonnes}
              months={input.demand.planning_horizon_months}
              onTonnesChange={(v) => updateDemand({ required_tonnes: v })}
              onMonthsChange={(v) =>
                updateDemand({ planning_horizon_months: v })
              }
            />

            {/* Advanced mode */}
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

            {/* Input brief summary */}
            <InputBriefSummary input={input} advancedMode={advancedMode} />

            {/* Validation errors */}
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

            {/* Scenario manager */}
            <div className="border-t border-zinc-800 pt-4">
              <ScenarioManager
                scenarios={scenarios}
                canSave={!!strategy && !!bm}
                onSave={() => {
                  if (!strategy || !bm) return;
                  const name = `${input.demand.required_tonnes.toLocaleString()}t / ${input.demand.planning_horizon_months}mo — ${strategy.signal}`;
                  saveScenario(name, input, strategy, bm, headlines.length);
                }}
                onLoad={(s) => {
                  setInput(structuredClone(s.inputs));
                  if (s.inputs.timeline || s.inputs.quality || s.inputs.commercial || s.inputs.logistics || s.inputs.finance) {
                    setAdvancedMode(true);
                  }
                }}
                onDelete={removeScenario}
                onRename={renameScenarioFn}
                onDuplicate={duplicateScenario}
                onExport={exportScenario}
                onImport={importScenario}
                onCompare={setCompareIds}
              />
            </div>
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

          {bm && (
            <LandedCostCard
              data={landedCost}
              loading={landedCostLoading}
              basisCentsLb={basisCentsLb}
              setBasisCentsLb={setBasisCentsLb}
              freightUsdT={freightUsdT}
              setFreightUsdT={setFreightUsdT}
              fxBdtUsd={fxBdtUsd}
              setFxBdtUsd={setFxBdtUsd}
            />
          )}

          {/* Price chart */}
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
              </div>
              <PriceChart
                prices={displayedPrices}
                benchmarks={priceData.benchmarks}
              />
            </div>
          )}

          {/* Scenario comparison */}
          {compareIds && (() => {
            const a = getScenario(compareIds[0]);
            const b = getScenario(compareIds[1]);
            if (a && b) {
              return (
                <ScenarioCompare a={a} b={b} onClose={() => setCompareIds(null)} />
              );
            }
            return null;
          })()}

          {/* Strategy results */}
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
        </main>
      </div>
    </div>
  );
}
