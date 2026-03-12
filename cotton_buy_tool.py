from dataclasses import dataclass
from typing import Literal, Dict, Any, Optional

import numpy as np
import pandas as pd

from data_functions import load_cotton_daily_series, get_fred_data


BuySignal = Literal["strong_buy", "buy", "hold", "avoid"]


@dataclass
class MillProfile:
    """
    Basic description of a spinning mill.

    This intentionally stays simple and uses daily yarn output as the primary
    driver of cotton consumption, which you can calibrate from spindle/yarn
    capacity offline.
    """

    name: str
    daily_yarn_output_kg: float  # total yarn produced per day (all counts)
    waste_rate_pct: float = 4.0  # carding/combing/other process losses, %
    target_inventory_days: int = 60  # how many days of cotton inventory to cover


def estimate_daily_cotton_consumption_kg(profile: MillProfile) -> float:
    """
    Estimate daily cotton consumption from daily yarn output and waste.
    """
    gross_factor = 1.0 + profile.waste_rate_pct / 100.0
    return profile.daily_yarn_output_kg * gross_factor


def load_cotton_price_series(
    csv_path: str,
    start_date: str = "2000-01-01",
) -> pd.Series:
    """
    Convenience wrapper to load the daily cotton price series as a Series.
    """
    df = load_cotton_daily_series(csv_path, start_date=start_date)
    return df["$/lbs"]


def compute_price_benchmarks(
    price_series: pd.Series,
    lookback_years: int = 5,
) -> Dict[str, Any]:
    """
    Compute simple statistical benchmarks for the most recent price.

    Benchmarks:
    - current price
    - lookback window stats (mean, std, z-score, 25th/50th/75th percentiles)
    """
    if price_series.empty:
        raise ValueError("price_series is empty")

    end = price_series.index[-1]
    start_cutoff = end - pd.DateOffset(years=lookback_years)
    window = price_series.loc[start_cutoff:end].dropna()

    current_price = price_series.iloc[-1]
    mean = window.mean()
    std = window.std(ddof=0)
    z_score = (current_price - mean) / std if std > 0 else np.nan

    percentiles = np.percentile(window.values, [25, 50, 75])

    return {
        "current_price": float(current_price),
        "lookback_years": lookback_years,
        "mean": float(mean),
        "std": float(std),
        "z_score": float(z_score),
        "p25": float(percentiles[0]),
        "p50": float(percentiles[1]),
        "p75": float(percentiles[2]),
    }


def compute_inflation_adjusted_price(
    price_series: pd.Series,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> pd.Series:
    """
    Adjust the cotton price series using a simple CPI-based deflator.

    This expects CPI from FRED via get_fred_data with the default CPI series.
    """
    if start_date is None:
        start_date = price_series.index[0].strftime("%Y-%m-%d")
    if end_date is None:
        end_date = price_series.index[-1].strftime("%Y-%m-%d")

    cpi_df = get_fred_data(start_date, end_date, {"CPI": "CPIAUCSL"}).ffill().bfill()
    cpi_df = cpi_df.reindex(price_series.index).ffill().bfill()

    base_cpi = cpi_df["CPI"].iloc[-1]
    real_price = price_series * (base_cpi / cpi_df["CPI"])

    return real_price.rename("real_price")


def classify_buy_signal(benchmarks: Dict[str, Any]) -> BuySignal:
    """
    Map statistical benchmarks to a coarse buy signal.
    """
    price = benchmarks["current_price"]
    p25 = benchmarks["p25"]
    p50 = benchmarks["p50"]
    z = benchmarks["z_score"]

    # Strong buy: statistically cheap and meaningfully below both p25 and median.
    if price <= p25 and z <= -0.5:
        return "strong_buy"

    # Buy: below median or mildly cheap on z-score.
    if price <= p50 or z <= -0.2:
        return "buy"

    # Avoid: expensive relative to history.
    if price >= benchmarks["p75"] and z >= 0.5:
        return "avoid"

    return "hold"


def suggest_purchase_quantity_bales(
    profile: MillProfile,
    signal: BuySignal,
    bale_weight_kg: float = 227.0,  # ~500 lbs
) -> float:
    """
    Suggest a cotton purchase quantity in bales based on the mill profile and signal.
    """
    daily_cotton_kg = estimate_daily_cotton_consumption_kg(profile)

    # Scale inventory days based on signal strength.
    if signal == "strong_buy":
        effective_days = profile.target_inventory_days
    elif signal == "buy":
        effective_days = max(int(profile.target_inventory_days * 0.5), 15)
    elif signal == "hold":
        effective_days = max(int(profile.target_inventory_days * 0.25), 7)
    else:  # "avoid"
        effective_days = 0

    total_kg = daily_cotton_kg * effective_days
    return total_kg / bale_weight_kg if bale_weight_kg > 0 else 0.0


def generate_recommendation(
    profile: MillProfile,
    cotton_csv_path: str,
    lookback_years: int = 5,
) -> Dict[str, Any]:
    """
    High-level helper that wires everything together for a mill.
    """
    px = load_cotton_price_series(cotton_csv_path)
    benchmarks = compute_price_benchmarks(px, lookback_years=lookback_years)
    real_px = compute_inflation_adjusted_price(px)
    signal = classify_buy_signal(benchmarks)
    qty_bales = suggest_purchase_quantity_bales(profile, signal)

    return {
        "mill": profile,
        "benchmarks": benchmarks,
        "signal": signal,
        "suggested_quantity_bales": qty_bales,
        "latest_real_price": float(real_px.iloc[-1]),
    }

