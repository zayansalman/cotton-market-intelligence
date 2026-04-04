"use client";

import { useState, useCallback } from "react";
import type { PurchaserInput, PresetName } from "@/lib/types";
import { PRESETS, purchaserInputSchema } from "@/lib/types";

const DEFAULT_INPUT: PurchaserInput = {
  demand: {
    required_tonnes: 2000,
    planning_horizon_months: 6,
  },
};

export function usePurchaserInput() {
  const [input, setInput] = useState<PurchaserInput>(DEFAULT_INPUT);
  const [advancedMode, setAdvancedMode] = useState(false);
  const [validationErrors, setValidationErrors] = useState<
    Array<{ path: string; message: string }>
  >([]);

  const updateDemand = useCallback(
    (patch: Partial<PurchaserInput["demand"]>) => {
      setInput((prev) => ({
        ...prev,
        demand: { ...prev.demand, ...patch },
      }));
    },
    []
  );

  const updateSection = useCallback(
    <K extends keyof Omit<PurchaserInput, "demand">>(
      section: K,
      patch: Partial<NonNullable<PurchaserInput[K]>>
    ) => {
      setInput((prev) => ({
        ...prev,
        [section]: { ...(prev[section] ?? {}), ...patch },
      }));
    },
    []
  );

  const applyPreset = useCallback((name: PresetName) => {
    setInput(structuredClone(PRESETS[name]));
    setAdvancedMode(true);
  }, []);

  const resetToBasic = useCallback(() => {
    setInput((prev) => ({
      demand: {
        required_tonnes: prev.demand.required_tonnes,
        planning_horizon_months: prev.demand.planning_horizon_months,
      },
    }));
    setAdvancedMode(false);
  }, []);

  const validate = useCallback((): boolean => {
    const result = purchaserInputSchema.safeParse(input);
    if (result.success) {
      setValidationErrors([]);
      return true;
    }
    setValidationErrors(
      result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }))
    );
    return false;
  }, [input]);

  return {
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
  };
}
