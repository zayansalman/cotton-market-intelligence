from __future__ import annotations

from dataclasses import dataclass


@dataclass
class MillProfileV1:
    """
    Mill profile focused on spindle-based cotton consumption and ordering.
    """

    name: str
    spindles: int
    spindle_speed_rpm: float
    yarn_count_ne: float
    machine_efficiency: float  # 0–1
    shifts_per_day: int
    target_days_inventory: int
    waste_factor: float = 0.05
    buys_per_year: int = 12
    max_order_tons: float | None = None


def compute_daily_cotton_consumption(profile: MillProfileV1) -> float:
    """
    Estimate daily cotton consumption in metric tons using a rule-of-thumb
    spindle-based production formula.
    """
    hours_per_shift = 8.0
    tpi_multiplier = 4.5
    tpi = tpi_multiplier * (profile.yarn_count_ne ** 0.5)

    eff = profile.machine_efficiency

    numerator = (
        profile.spindles
        * profile.spindle_speed_rpm
        * 60.0
        * hours_per_shift
        * profile.shifts_per_day
        * eff
    )
    denominator = tpi * profile.yarn_count_ne * 840.0 * 36.0

    if denominator <= 0:
        raise ValueError("Invalid parameters for yarn production calculation.")

    production_lbs_per_day = numerator / denominator
    production_kg_per_day = production_lbs_per_day * 0.453592

    cotton_kg_per_day = production_kg_per_day * (1.0 + profile.waste_factor)
    cotton_tons_per_day = cotton_kg_per_day / 1000.0
    return float(cotton_tons_per_day)


def compute_base_order_quantity(profile: MillProfileV1) -> float:
    """
    Compute the unadjusted base order quantity per buy (in metric tons).
    """
    daily_tons = compute_daily_cotton_consumption(profile)
    base_qty = (profile.target_days_inventory * daily_tons) / float(
        profile.buys_per_year
    )
    if profile.max_order_tons is not None:
        return float(min(base_qty, profile.max_order_tons))
    return float(base_qty)

