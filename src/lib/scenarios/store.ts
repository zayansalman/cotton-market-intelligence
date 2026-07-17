/**
 * localStorage-backed scenario CRUD.
 *
 * All operations are synchronous (localStorage is sync).
 * Version field enables future migrations.
 */

import { purchaserInputSchema } from "../schemas/purchaser-input";
import type { Scenario } from "./types";

const STORAGE_KEY = "cmi_scenarios";

function readAll(): Scenario[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Guard against a non-array payload (corrupted / hand-edited storage):
    // callers like listScenarios() call .sort() and would crash otherwise.
    return Array.isArray(parsed) ? (parsed as Scenario[]) : [];
  } catch {
    return [];
  }
}

/**
 * Structural validation for an untrusted, parsed scenario object.
 *
 * There is no Zod schema for the whole Scenario, so we validate the fields the
 * UI actually depends on to render (name, inputs, market snapshot, strategy,
 * version). `inputs` is validated against the canonical Zod schema; the rest
 * are defensive structural checks. `id` / `created_at` are intentionally not
 * required here because importScenario reassigns them.
 */
function isValidScenarioShape(value: unknown): value is Scenario {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;

  if (typeof s.name !== "string") return false;
  if (s.version !== 1) return false;

  // inputs — canonical Zod schema is the source of truth.
  if (!purchaserInputSchema.safeParse(s.inputs).success) return false;

  // market_snapshot.benchmarks must be an object.
  if (typeof s.market_snapshot !== "object" || s.market_snapshot === null) {
    return false;
  }
  const snapshot = s.market_snapshot as Record<string, unknown>;
  if (typeof snapshot.benchmarks !== "object" || snapshot.benchmarks === null) {
    return false;
  }

  // strategy — check the fields consumed by the scenario list / compare views.
  if (typeof s.strategy !== "object" || s.strategy === null) return false;
  const strategy = s.strategy as Record<string, unknown>;
  if (typeof strategy.signal !== "string") return false;
  if (typeof strategy.confidence !== "number") return false;
  if (!Array.isArray(strategy.monthly_plan)) return false;
  if (!Array.isArray(strategy.risk_factors)) return false;
  if (!Array.isArray(strategy.next_actions)) return false;

  return true;
}

function writeAll(scenarios: Scenario[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios));
}

export function listScenarios(): Scenario[] {
  return readAll().sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export function getScenario(id: string): Scenario | undefined {
  return readAll().find((s) => s.id === id);
}

export function saveScenario(scenario: Scenario): void {
  const all = readAll();
  const idx = all.findIndex((s) => s.id === scenario.id);
  if (idx >= 0) {
    all[idx] = scenario;
  } else {
    all.push(scenario);
  }
  writeAll(all);
}

export function deleteScenario(id: string): void {
  writeAll(readAll().filter((s) => s.id !== id));
}

export function renameScenario(id: string, name: string): void {
  const all = readAll();
  const scenario = all.find((s) => s.id === id);
  if (scenario) {
    scenario.name = name;
    writeAll(all);
  }
}

export function duplicateScenario(id: string): Scenario | undefined {
  const original = getScenario(id);
  if (!original) return undefined;
  const copy: Scenario = {
    ...structuredClone(original),
    id: crypto.randomUUID(),
    name: `${original.name} (copy)`,
    created_at: new Date().toISOString(),
  };
  saveScenario(copy);
  return copy;
}

export function exportScenario(id: string): string | undefined {
  const scenario = getScenario(id);
  if (!scenario) return undefined;
  return JSON.stringify(scenario, null, 2);
}

export function importScenario(json: string): Scenario {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid scenario file: not valid JSON.");
  }
  if (!isValidScenarioShape(parsed)) {
    throw new Error(
      "Invalid scenario file: structure does not match the scenario schema."
    );
  }
  // Only reached with a structurally-valid scenario — safe to persist.
  const scenario: Scenario = {
    ...parsed,
    // Assign new ID / timestamp to avoid collisions with existing scenarios.
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
  };
  saveScenario(scenario);
  return scenario;
}

export function createScenarioId(): string {
  return crypto.randomUUID();
}
