/**
 * Alert rules localStorage persistence (#8).
 */

import type { AlertRule, AlertState } from "./types";

const RULES_KEY = "cmi_alert_rules";
const STATE_KEY = "cmi_alert_state";

export function loadRules(): AlertRule[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RULES_KEY);
    return raw ? (JSON.parse(raw) as AlertRule[]) : [];
  } catch {
    return [];
  }
}

export function saveRules(rules: AlertRule[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(RULES_KEY, JSON.stringify(rules));
}

export function loadAlertState(): AlertState {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as AlertState) : {};
  } catch {
    return {};
  }
}

export function saveAlertState(state: AlertState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

export function generateRuleId(): string {
  return `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
