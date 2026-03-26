from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Dict

import pandas as pd

from ..analytics.benchmarks_v1 import evaluate_spot_snapshot
from ..mills.capacity_v1 import MillProfileV1, compute_base_order_quantity


BuySignalV1 = Literal["STRONG_BUY", "BUY", "HOLD", "AVOID"]


@dataclass
class SignalConfigV1:
    """
    Thresholds and quantity scalers for value/momentum/volatility-based signals.
    """

    value_buy_percentile: float = 0.25
    value_strong_buy_percentile: float = 0.15
    max_vol_30d_multiple_of_median: float = 2.0
    strong_buy_qty_multiplier: float = 1.5
    buy_qty_multiplier: float = 1.0
    hold_qty_multiplier: float = 0.0
    avoid_qty_multiplier: float = 0.0


@dataclass
class BuyDecisionV1:
    signal: BuySignalV1
    reason: str
    suggested_qty_tons: float
    components: Dict[str, float]


def compute_signal_components_for_date(
    df_with_benchmarks: pd.DataFrame,
    as_of: pd.Timestamp | None = None,
) -> Dict[str, float]:
    """
    Build the component metrics dictionary used by the rule engine.
    """
    snapshot = evaluate_spot_snapshot(df_with_benchmarks, as_of=as_of)

    vol_30d = snapshot.get("vol_30d", float("nan"))
    vol_history = df_with_benchmarks["vol_30d"].dropna() if "vol_30d" in df_with_benchmarks else pd.Series(dtype=float)
    vol_median = float(vol_history.median()) if not vol_history.empty else float("nan")

    components: Dict[str, float] = {
        "current_price": snapshot.get("current_price", float("nan")),
        "real_price_indexed": snapshot.get("real_price_indexed", float("nan")),
        "pct_252d": snapshot.get("pct_252d", float("nan")),
        "pct_252d_p25": snapshot.get("pct_252d_p25", float("nan")),
        "pct_252d_p75": snapshot.get("pct_252d_p75", float("nan")),
        "z_90d": snapshot.get("z_90d", float("nan")),
        "z_252d": snapshot.get("z_252d", float("nan")),
        "vol_30d": vol_30d,
        "vol_30d_median": vol_median,
    }
    return components


def decide_buy(
    components: Dict[str, float],
    base_qty_tons: float,
    config: SignalConfigV1 | None = None,
) -> BuyDecisionV1:
    """
    Map benchmark components and base quantity into a discrete signal and quantity.
    """
    if config is None:
        config = SignalConfigV1()

    pct_252d = components.get("pct_252d")
    vol_30d = components.get("vol_30d")
    vol_median = components.get("vol_30d_median")

    signal: BuySignalV1
    reason: str

    # Default to HOLD if key metrics are missing.
    if pct_252d is None or pd.isna(pct_252d):
        signal = "HOLD"
        reason = "Insufficient benchmark history; maintain normal purchasing cadence."
    else:
        # Basic value-based rules.
        if pct_252d <= config.value_strong_buy_percentile:
            signal = "STRONG_BUY"
            reason = "Cotton spot price is in the cheapest historical band; build inventory aggressively."
        elif pct_252d <= config.value_buy_percentile:
            signal = "BUY"
            reason = "Cotton spot price is relatively cheap; step up buying."
        else:
            signal = "HOLD"
            reason = "Cotton spot price is not particularly cheap; maintain cadence."

        # Volatility filter: if realized volatility is very elevated, temper buying.
        if (
            vol_30d is not None
            and vol_median is not None
            and not pd.isna(vol_30d)
            and not pd.isna(vol_median)
            and vol_median > 0
        ):
            if vol_30d > config.max_vol_30d_multiple_of_median * vol_median:
                if signal in ("STRONG_BUY", "BUY"):
                    signal = "HOLD"
                    reason = (
                        "Price looks cheap but short-term volatility is elevated; "
                        "slow down purchases until the market stabilizes."
                    )

    if signal == "STRONG_BUY":
        qty = base_qty_tons * config.strong_buy_qty_multiplier
    elif signal == "BUY":
        qty = base_qty_tons * config.buy_qty_multiplier
    elif signal == "HOLD":
        qty = base_qty_tons * config.hold_qty_multiplier
    else:
        qty = base_qty_tons * config.avoid_qty_multiplier

    return BuyDecisionV1(
        signal=signal,
        reason=reason,
        suggested_qty_tons=float(qty),
        components=components,
    )


def generate_signal_for_date(
    df_with_benchmarks: pd.DataFrame,
    profile: MillProfileV1,
    as_of: pd.Timestamp | None = None,
    config: SignalConfigV1 | None = None,
) -> BuyDecisionV1:
    """
    High-level helper: compute components, base quantity, and a BuyDecisionV1 for a date.
    """
    components = compute_signal_components_for_date(df_with_benchmarks, as_of=as_of)
    base_qty = compute_base_order_quantity(profile)
    decision = decide_buy(components, base_qty_tons=base_qty, config=config)
    return decision

