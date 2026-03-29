from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import numpy as np
import pandas as pd


@dataclass
class BenchmarksConfig:
    """
    Configuration for rolling benchmark calculations on cotton prices.
    """

    percentile_windows: Sequence[int] = (252, 756)  # ~1y, ~3y
    zscore_windows: Sequence[int] = (90, 252)  # ~3m, ~1y
    vol_windows: Sequence[int] = (30, 90)
    base_year_for_real: int = 2015


def _rolling_percentile(series: pd.Series, window: int, q: float) -> pd.Series:
    return (
        series.rolling(window)
        .apply(lambda x: np.nanpercentile(x, q * 100.0), raw=True)
        .astype(float)
    )


def _rolling_value_pct_rank_last(x: np.ndarray) -> float:
    """
    Fraction of observations in the window that are <= the last (today's) price.
    Returns a number in [0, 1] (empirical CDF rank). NaN if insufficient data.
    """
    if x.size < 2:
        return float("nan")
    if np.any(np.isnan(x)):
        return float("nan")
    last = x[-1]
    return float(np.sum(x <= last) / float(x.size))


def compute_price_benchmarks(
    df: pd.DataFrame,
    config: BenchmarksConfig | None = None,
    price_col: str = "cotton_spot_usd_per_lb",
    real_price_col: str | None = "cotton_spot_real",
) -> pd.DataFrame:
    """
    Enrich a price DataFrame with rolling percentiles, z-scores, and volatility.
    """
    if config is None:
        config = BenchmarksConfig()

    if price_col not in df.columns:
        raise ValueError(f"Expected '{price_col}' in input DataFrame.")

    out = df.copy()
    price = out[price_col].astype(float)

    # Rolling percentiles for price (price *levels* in $/lb — not rank of today)
    for w in config.percentile_windows:
        out[f"pct_{w}d"] = _rolling_percentile(price, window=w, q=0.5)
        out[f"pct_{w}d_p25"] = _rolling_percentile(price, window=w, q=0.25)
        out[f"pct_{w}d_p75"] = _rolling_percentile(price, window=w, q=0.75)
        # Empirical percentile *rank* of today's price within the rolling window (0–1).
        # Low = cheap vs recent history; high = expensive. Used for value-based signals.
        out[f"value_pct_rank_{w}d"] = price.rolling(w).apply(
            _rolling_value_pct_rank_last,
            raw=True,
        )

    # Rolling z-scores
    for w in config.zscore_windows:
        rolling_mean = price.rolling(w).mean()
        rolling_std = price.rolling(w).std(ddof=0)
        out[f"z_{w}d"] = (price - rolling_mean) / rolling_std.replace(0, np.nan)
        out[f"ma_{w}d"] = rolling_mean

    # Rolling volatility of log returns
    log_ret = np.log(price / price.shift(1))
    for w in config.vol_windows:
        out[f"vol_{w}d"] = log_ret.rolling(w).std()

    # Real price indexed to base year, if available
    if real_price_col and real_price_col in out.columns:
        real_series = out[real_price_col].astype(float)
        base_mask = real_series.index.year == config.base_year_for_real
        if base_mask.any():
            base_level = float(real_series[base_mask].mean())
            if base_level != 0:
                out["real_price_indexed"] = 100.0 * real_series / base_level

    return out


def evaluate_spot_snapshot(
    df_with_benchmarks: pd.DataFrame,
    as_of: pd.Timestamp | None = None,
    price_col: str = "cotton_spot_usd_per_lb",
) -> dict:
    """
    Extract a compact snapshot of current benchmarks for reporting and signals.
    """
    if df_with_benchmarks.empty:
        raise ValueError("DataFrame is empty.")

    if as_of is None:
        row = df_with_benchmarks.iloc[-1]
        date = df_with_benchmarks.index[-1]
    else:
        if as_of not in df_with_benchmarks.index:
            df_sorted = df_with_benchmarks.sort_index()
            date = df_sorted.index[df_sorted.index.get_loc(as_of, method="ffill")]
            row = df_sorted.loc[date]
        else:
            date = as_of
            row = df_with_benchmarks.loc[as_of]

    out: dict = {"as_of": date, "current_price": float(row[price_col])}

    # Collect key benchmark fields if present.
    for col in [
        "cotton_spot_real",
        "real_price_indexed",
        "pct_252d",
        "pct_756d",
        "pct_252d_p25",
        "pct_252d_p75",
        "value_pct_rank_252d",
        "value_pct_rank_756d",
        "z_90d",
        "z_252d",
        "vol_30d",
        "vol_90d",
    ]:
        if col in df_with_benchmarks.columns:
            value = row[col]
            out[col] = float(value) if pd.notna(value) else float("nan")

    return out

