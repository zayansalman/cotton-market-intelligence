from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Literal

import pandas as pd

from .benchmarks import evaluate_spot_snapshot
from .capacity import MillProfile, compute_base_order_quantity


BuySignal = Literal["STRONG_BUY", "BUY", "HOLD", "AVOID"]


@dataclass
class SignalConfig:
    value_buy_percentile: float = 0.25
    value_strong_buy_percentile: float = 0.15
    momentum_ma_short: int = 30
    momentum_ma_long: int = 90
    max_vol_30d_multiple_of_median: float = 2.0
    strong_buy_qty_multiplier: float = 1.5
    buy_qty_multiplier: float = 1.0
    hold_qty_multiplier: float = 0.0
    avoid_qty_multiplier: float = 0.0


@dataclass
class BuyDecision:
    signal: BuySignal
    reason: str
    suggested_qty_tons: float
    components: Dict[str, float]


def compute_signal_components(
    price_row: pd.Series,
    benchmarks_row: pd.Series,
) -> Dict[str, float]:
    components: Dict[str, float] = {
        "current_price": float(price_row.get("cotton_spot_usd_per_lb", float("nan"))),
        "value_pct_rank_252d": float(
            benchmarks_row.get("value_pct_rank_252d", float("nan"))
        ),
        "z_90d": float(benchmarks_row.get("z_90d", float("nan"))),
        "z_252d": float(benchmarks_row.get("z_252d", float("nan"))),
        "vol_30d": float(benchmarks_row.get("vol_30d", float("nan"))),
    }
    return components


def decide_buy(
    components: Dict[str, float],
    base_qty_tons: float,
    config: SignalConfig | None = None,
) -> BuyDecision:
    if config is None:
        config = SignalConfig()

    value_rank = components.get("value_pct_rank_252d", float("nan"))
    vol_30d = components.get("vol_30d", float("nan"))
    vol_30d_median = components.get("vol_30d_median", float("nan"))
    momentum_ok = bool(components.get("momentum_ok", True))

    if pd.isna(value_rank):
        signal: BuySignal = "HOLD"
        reason = "Insufficient history for a percentile-based decision."
    elif value_rank <= config.value_strong_buy_percentile and momentum_ok:
        signal = "STRONG_BUY"
        reason = "Spot is in the cheapest band vs 1Y history and momentum is supportive."
    elif value_rank <= config.value_buy_percentile and momentum_ok:
        signal = "BUY"
        reason = "Spot is below typical vs 1Y history and momentum is supportive."
    elif value_rank > 0.75:
        signal = "AVOID"
        reason = "Spot is expensive vs 1Y history."
    else:
        signal = "HOLD"
        reason = "Mixed signals; keep regular cadence."

    if (
        signal in ("STRONG_BUY", "BUY")
        and not pd.isna(vol_30d)
        and not pd.isna(vol_30d_median)
        and vol_30d_median > 0
        and vol_30d > config.max_vol_30d_multiple_of_median * vol_30d_median
    ):
        signal = "HOLD"
        reason = "Value is attractive but volatility is elevated."

    if signal == "STRONG_BUY":
        qty = base_qty_tons * config.strong_buy_qty_multiplier
    elif signal == "BUY":
        qty = base_qty_tons * config.buy_qty_multiplier
    elif signal == "HOLD":
        qty = base_qty_tons * config.hold_qty_multiplier
    else:
        qty = base_qty_tons * config.avoid_qty_multiplier

    return BuyDecision(
        signal=signal,
        reason=reason,
        suggested_qty_tons=float(qty),
        components=components,
    )


def generate_signal_for_date(
    df_with_benchmarks: pd.DataFrame,
    profile: MillProfile,
    as_of: pd.Timestamp | None = None,
    config: SignalConfig | None = None,
) -> BuyDecision:
    if df_with_benchmarks.empty:
        raise ValueError("df_with_benchmarks is empty.")

    if as_of is None:
        row = df_with_benchmarks.iloc[-1]
    else:
        if as_of not in df_with_benchmarks.index:
            idx = df_with_benchmarks.index[df_with_benchmarks.index.get_loc(as_of, method="ffill")]
            row = df_with_benchmarks.loc[idx]
        else:
            row = df_with_benchmarks.loc[as_of]

    snapshot = evaluate_spot_snapshot(df_with_benchmarks, as_of=as_of)
    components = {
        "current_price": snapshot.get("current_price", float("nan")),
        "value_pct_rank_252d": snapshot.get("value_pct_rank_252d", float("nan")),
        "z_90d": snapshot.get("z_90d", float("nan")),
        "z_252d": snapshot.get("z_252d", float("nan")),
        "vol_30d": snapshot.get("vol_30d", float("nan")),
    }

    # Benchmarks expose ma_90d / ma_252d from z-score windows (see benchmarks_v1).
    ma_short = row.get("ma_90d", float("nan"))
    ma_long = row.get("ma_252d", float("nan"))
    if pd.notna(ma_short) and pd.notna(ma_long):
        components["momentum_ok"] = float(ma_short >= ma_long)

    if "vol_30d" in df_with_benchmarks.columns:
        vol_hist = df_with_benchmarks["vol_30d"].dropna()
        if not vol_hist.empty:
            components["vol_30d_median"] = float(vol_hist.median())

    base_qty = compute_base_order_quantity(profile)
    return decide_buy(components=components, base_qty_tons=base_qty, config=config)


__all__ = [
    "SignalConfig",
    "BuyDecision",
    "compute_signal_components",
    "decide_buy",
    "generate_signal_for_date",
]

