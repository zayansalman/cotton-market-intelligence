"use client";

import { useState, useCallback, useEffect } from "react";
import type { Scenario } from "@/lib/scenarios/types";
import {
  listScenarios,
  saveScenario,
  deleteScenario,
  renameScenario,
  duplicateScenario,
  exportScenario,
  importScenario,
  createScenarioId,
} from "@/lib/scenarios/store";
import type { PurchaserInput } from "@/lib/types";
import type { Strategy, Benchmarks } from "@/lib/types";

export function useScenarios() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [compareIds, setCompareIds] = useState<[string, string] | null>(null);

  const refresh = useCallback(() => {
    setScenarios(listScenarios());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = useCallback(
    (
      name: string,
      inputs: PurchaserInput,
      strategy: Strategy,
      benchmarks: Benchmarks,
      headlinesCount: number
    ) => {
      const scenario: Scenario = {
        id: createScenarioId(),
        name,
        created_at: new Date().toISOString(),
        inputs,
        market_snapshot: {
          benchmarks,
          headlines_count: headlinesCount,
          price_date: benchmarks.price_date,
        },
        strategy,
        version: 1,
      };
      saveScenario(scenario);
      refresh();
      return scenario;
    },
    [refresh]
  );

  const remove = useCallback(
    (id: string) => {
      deleteScenario(id);
      refresh();
    },
    [refresh]
  );

  const rename = useCallback(
    (id: string, name: string) => {
      renameScenario(id, name);
      refresh();
    },
    [refresh]
  );

  const duplicate = useCallback(
    (id: string) => {
      duplicateScenario(id);
      refresh();
    },
    [refresh]
  );

  const doExport = useCallback((id: string) => {
    const json = exportScenario(id);
    if (!json) return;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scenario_${id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const doImport = useCallback(
    (json: string) => {
      importScenario(json);
      refresh();
    },
    [refresh]
  );

  return {
    scenarios,
    save,
    remove,
    rename,
    duplicate,
    doExport,
    doImport,
    compareIds,
    setCompareIds,
    refresh,
  };
}
