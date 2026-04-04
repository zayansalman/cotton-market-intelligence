/**
 * localStorage-backed scenario CRUD.
 *
 * All operations are synchronous (localStorage is sync).
 * Version field enables future migrations.
 */

import type { Scenario } from "./types";

const STORAGE_KEY = "cmi_scenarios";

function readAll(): Scenario[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Scenario[];
  } catch {
    return [];
  }
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
  const scenario = JSON.parse(json) as Scenario;
  // Assign new ID to avoid collisions
  scenario.id = crypto.randomUUID();
  scenario.created_at = new Date().toISOString();
  saveScenario(scenario);
  return scenario;
}

export function createScenarioId(): string {
  return crypto.randomUUID();
}
