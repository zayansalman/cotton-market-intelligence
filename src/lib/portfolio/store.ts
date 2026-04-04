/**
 * Multi-mill portfolio localStorage persistence (#7).
 */

import type { Mill } from "./types";

const STORAGE_KEY = "cmi_portfolio_mills";

export function loadMills(): Mill[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Mill[];
  } catch {
    return [];
  }
}

export function saveMills(mills: Mill[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(mills));
}

export function generateId(): string {
  return `mill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
