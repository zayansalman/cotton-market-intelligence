from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Any

import pandas as pd

from .cotton_data import (
    load_macrotrends_daily,
    get_fred_series,
)
from .mill_profile import MillProfile
from .signals import build_signal_from_series, SignalDecision


@dataclass
class Recommendation:
    """
    Aggregate recommendation for a given mill.
    """

    mill: MillProfile
    signal_decision: SignalDecision
    suggested_order_kg: float
    suggested_order_bales: float
    latest_nominal_price: float
    latest_real_price: float


def _suggest_order_kg(
    mill: MillProfile,
    signal: str,
) -> float:
    """
    Map signal strength to suggested order size in kg.
    """
    daily_cotton_kg = mill.estimate_daily_cotton_consumption_kg()

    if signal == "strong_buy":
        effective_days = mill.target_inventory_days
    elif signal == "buy":
        effective_days = max(int(mill.target_inventory_days * 0.5), 15)
    elif signal == "hold":
        effective_days = max(int(mill.target_inventory_days * 0.25), 7)
    else:  # avoid
        effective_days = 0

    return daily_cotton_kg * effective_days


def generate_recommendation(
    mill: MillProfile,
    cotton_csv_path: str,
    cpi_code_dict: Dict[str, str] | None = None,
    lookback_years: int = 5,
    vol_window_days: int = 60,
    bale_weight_kg: float = 227.0,
) -> Recommendation:
    """
    Top-level API: given a mill and data config, return a Recommendation.
    """
    if cpi_code_dict is None:
        cpi_code_dict = {"CPI": "CPIAUCSL"}

    spot_df = load_macrotrends_daily(cotton_csv_path)
    spot_series = spot_df.iloc[:, 0]

    start_date = spot_series.index[0].strftime("%Y-%m-%d")
    end_date = spot_series.index[-1].strftime("%Y-%m-%d")

    fred_df = get_fred_series(start_date, end_date, cpi_code_dict).ffill().bfill()
    cpi_series = fred_df.iloc[:, 0]

    decision = build_signal_from_series(
        nominal_series=spot_series,
        cpi_series=cpi_series,
        value_horizon_years=lookback_years,
        vol_window_days=vol_window_days,
    )

    order_kg = _suggest_order_kg(mill, decision.signal)
    order_bales = order_kg / bale_weight_kg if bale_weight_kg > 0 else 0.0

    # Compute latest real price for reporting.
    # Reuse build_signal_from_series inputs by recomputing real price here.
    from .cotton_data import compute_real_price  # local import to avoid cycle

    real_series = compute_real_price(spot_series, cpi_series)

    return Recommendation(
        mill=mill,
        signal_decision=decision,
        suggested_order_kg=order_kg,
        suggested_order_bales=order_bales,
        latest_nominal_price=float(spot_series.iloc[-1]),
        latest_real_price=float(real_series.iloc[-1]),
    )


def recommendation_to_dict(rec: Recommendation) -> Dict[str, Any]:
    """
    Convenience converter for JSON/CLI or future API usage.
    """
    return {
        "mill": {
            "name": rec.mill.name,
            "daily_yarn_output_kg": rec.mill.daily_yarn_output_kg,
            "spindles": rec.mill.spindles,
            "spindle_rpm": rec.mill.spindle_rpm,
            "yarn_count_ne": rec.mill.yarn_count_ne,
            "efficiency_pct": rec.mill.efficiency_pct,
            "shifts_per_day": rec.mill.shifts_per_day,
            "waste_rate_pct": rec.mill.waste_rate_pct,
            "target_inventory_days": rec.mill.target_inventory_days,
        },
        "signal": rec.signal_decision.signal,
        "scores": {
            "value_z_score": rec.signal_decision.scores.value_score,
            "volatility_score": rec.signal_decision.scores.volatility_score,
        },
        "benchmarks": rec.signal_decision.benchmarks,
        "horizons": rec.signal_decision.horizons,
        "commentary": rec.signal_decision.commentary,
        "suggested_order_kg": rec.suggested_order_kg,
        "suggested_order_bales": rec.suggested_order_bales,
        "latest_nominal_price": rec.latest_nominal_price,
        "latest_real_price": rec.latest_real_price,
    }

