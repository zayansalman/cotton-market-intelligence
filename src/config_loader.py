from __future__ import annotations

from pathlib import Path
from typing import Dict

import yaml

from .buy_rules import SignalConfig
from .capacity import MillProfile


def load_mill_profiles(path: str | Path) -> Dict[str, MillProfile]:
    with open(path, "r", encoding="utf-8") as f:
        records = yaml.safe_load(f) or []
    profiles: Dict[str, MillProfile] = {}
    for record in records:
        p = MillProfile.from_dict(record)
        profiles[p.name] = p
    return profiles


def load_signal_config(path: str | Path) -> SignalConfig:
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}

    value = raw.get("value", {})
    momentum = raw.get("momentum", {})
    volatility = raw.get("volatility", {})
    qty = raw.get("quantity_scalers", {})

    return SignalConfig(
        value_buy_percentile=float(value.get("buy_percentile", 0.25)),
        value_strong_buy_percentile=float(value.get("strong_buy_percentile", 0.15)),
        momentum_ma_short=int(momentum.get("ma_window_short", 30)),
        momentum_ma_long=int(momentum.get("ma_window_long", 90)),
        max_vol_30d_multiple_of_median=float(
            volatility.get("max_vol_30d_multiple_of_median", 2.0)
        ),
        strong_buy_qty_multiplier=float(qty.get("strong_buy", 1.5)),
        buy_qty_multiplier=float(qty.get("buy", 1.0)),
        hold_qty_multiplier=float(qty.get("hold", 0.0)),
        avoid_qty_multiplier=float(qty.get("avoid", 0.0)),
    )

