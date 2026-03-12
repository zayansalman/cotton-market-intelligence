from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Literal

import pandas as pd

from .cotton_data import compute_price_benchmarks, compute_real_price, compute_rolling_vol


BuySignal = Literal["strong_buy", "buy", "hold", "avoid"]


@dataclass
class SignalScores:
    """
    Container for intermediate signal scores.
    """

    value_score: float
    volatility_score: float
    momentum_score: float | None = None


@dataclass
class SignalDecision:
    """
    Final decision object for a cotton buy signal.
    """

    signal: BuySignal
    scores: SignalScores
    benchmarks: Dict[str, float]
    horizons: Dict[str, float]
    commentary: str


def score_value(
    real_price_series: pd.Series,
    horizon_years: int = 5,
) -> Dict[str, float]:
    """
    Score value based on real (CPI-adjusted) cotton price vs history.
    """
    real_price_series = real_price_series.dropna()
    if real_price_series.empty:
        raise ValueError("real_price_series is empty")

    bm = compute_price_benchmarks(real_price_series, horizon_years=horizon_years)
    return bm


def score_volatility(
    nominal_series: pd.Series,
    vol_window_days: int = 60,
) -> float:
    """
    Score volatility based on recent realized volatility.

    Lower volatility is generally preferred for executing buys; here we just
    return the latest rolling volatility value to be interpreted relative to
    its own history or heuristics.
    """
    vol_series = compute_rolling_vol(nominal_series, window_days=vol_window_days)
    return float(vol_series.iloc[-1])


def classify_signal(
    benchmarks: Dict[str, float],
    volatility_value: float,
    thresholds: Dict[str, float] | None = None,
) -> SignalDecision:
    """
    Classify into strong_buy/buy/hold/avoid based primarily on value, with
    volatility as a secondary consideration.
    """
    if thresholds is None:
        thresholds = {
            "z_strong_buy": -0.5,
            "z_buy": -0.2,
            "z_avoid": 0.5,
        }

    price = benchmarks["current_price"]
    p25 = benchmarks["p25"]
    p50 = benchmarks["p50"]
    p75 = benchmarks["p75"]
    z = benchmarks["z_score"]

    # Simple value-based rules first.
    if price <= p25 and z <= thresholds["z_strong_buy"]:
        signal: BuySignal = "strong_buy"
        commentary = "Price is statistically cheap versus history; consider building inventory."
    elif price <= p50 or z <= thresholds["z_buy"]:
        signal = "buy"
        commentary = "Price is below typical levels; incremental buying is reasonable."
    elif price >= p75 and z >= thresholds["z_avoid"]:
        signal = "avoid"
        commentary = "Price is elevated versus history; avoid new long cotton unless necessary."
    else:
        signal = "hold"
        commentary = "Price is around normal levels; maintain regular purchasing cadence."

    scores = SignalScores(
        value_score=float(z),
        volatility_score=float(volatility_value),
        momentum_score=None,
    )

    return SignalDecision(
        signal=signal,
        scores=scores,
        benchmarks=benchmarks,
        horizons={
            "value_horizon_years": benchmarks.get("horizon_years", 5.0),
        },
        commentary=commentary,
    )


def build_signal_from_series(
    nominal_series: pd.Series,
    cpi_series: pd.Series,
    value_horizon_years: int = 5,
    vol_window_days: int = 60,
) -> SignalDecision:
    """
    High-level helper that derives a SignalDecision from raw series.
    """
    nominal_series = nominal_series.dropna()
    cpi_series = cpi_series.dropna()

    real_series = compute_real_price(nominal_series, cpi_series)
    bm = score_value(real_series, horizon_years=value_horizon_years)
    vol_value = score_volatility(nominal_series, vol_window_days=vol_window_days)

    decision = classify_signal(bm, vol_value)
    return decision

