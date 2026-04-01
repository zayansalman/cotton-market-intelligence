/**
 * Bangladesh-specific origin lead-time presets and import-credit assumptions.
 *
 * Pure data — no React/Next imports.
 */

/** Estimated transit days from origin to Chattogram. */
export const ORIGIN_LEAD_TIMES: Record<string, { transit_days: number; label: string }> = {
  India: { transit_days: 14, label: "Fast lane (subcontinent)" },
  Pakistan: { transit_days: 14, label: "Fast lane (subcontinent)" },
  US: { transit_days: 45, label: "Long-haul (Americas)" },
  Brazil: { transit_days: 40, label: "Long-haul (Americas)" },
  Australia: { transit_days: 30, label: "Mid-haul (Oceania)" },
  "West Africa": { transit_days: 35, label: "Mid-haul (Africa)" },
  Uzbekistan: { transit_days: 25, label: "Mid-haul (Central Asia)" },
  Egypt: { transit_days: 20, label: "Mid-haul (Middle East)" },
};

/** Default origin lead-time when no match found. */
export const DEFAULT_LEAD_TIME_DAYS = 40;

/** Bangladesh import credit stress thresholds. */
export const CREDIT_STRESS = {
  /** Beyond this many credit days, banks start pushing back. */
  soft_limit_days: 90,
  /** Hard ceiling for most BD banks. */
  hard_limit_days: 180,
  /** If monthly spend rate (USD) exceeds this per lot, pacing should slow. */
  high_velocity_usd_per_month: 5_000_000,
};

export function getLeadTimeDays(origin: string): number {
  return ORIGIN_LEAD_TIMES[origin]?.transit_days ?? DEFAULT_LEAD_TIME_DAYS;
}

export function getMinLeadTimeDays(origins: string[]): number {
  if (origins.length === 0) return DEFAULT_LEAD_TIME_DAYS;
  return Math.min(...origins.map(getLeadTimeDays));
}

export function getMaxLeadTimeDays(origins: string[]): number {
  if (origins.length === 0) return DEFAULT_LEAD_TIME_DAYS;
  return Math.max(...origins.map(getLeadTimeDays));
}
