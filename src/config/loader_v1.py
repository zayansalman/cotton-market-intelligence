from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Dict

import yaml

from ..mills.capacity_v1 import MillProfileV1
from ..signals.buy_rules_v1 import SignalConfigV1


def load_mill_profiles(path: str | Path) -> Dict[str, MillProfileV1]:
    """
    Load mill profiles from a YAML file into a mapping keyed by mill name.
    """
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or []

    profiles: Dict[str, MillProfileV1] = {}
    for entry in data:
        profile = MillProfileV1(
            name=entry["name"],
            spindles=int(entry["spindles"]),
            spindle_speed_rpm=float(entry["spindle_speed_rpm"]),
            yarn_count_ne=float(entry["yarn_count_ne"]),
            machine_efficiency=float(entry["machine_efficiency"]),
            shifts_per_day=int(entry["shifts_per_day"]),
            target_days_inventory=int(entry["target_days_inventory"]),
            waste_factor=float(entry.get("waste_factor", 0.05)),
            buys_per_year=int(entry.get("buys_per_year", 12)),
            max_order_tons=(
                float(entry["max_order_tons"])
                if entry.get("max_order_tons") is not None
                else None
            ),
        )
        profiles[profile.name] = profile
    return profiles


def load_signal_config(path: str | Path) -> SignalConfigV1:
    """
    Load signal rule thresholds and quantity scalers from YAML.
    """
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    value_cfg = data.get("value", {})
    vol_cfg = data.get("volatility", {})
    qty_cfg = data.get("quantity_scalers", {})

    return SignalConfigV1(
        value_buy_percentile=float(value_cfg.get("buy_percentile", 0.25)),
        value_strong_buy_percentile=float(
            value_cfg.get("strong_buy_percentile", 0.15)
        ),
        max_vol_30d_multiple_of_median=float(
            vol_cfg.get("max_vol_30d_multiple_of_median", 2.0)
        ),
        strong_buy_qty_multiplier=float(qty_cfg.get("STRONG_BUY", 1.5)),
        buy_qty_multiplier=float(qty_cfg.get("BUY", 1.0)),
        hold_qty_multiplier=float(qty_cfg.get("HOLD", 0.0)),
        avoid_qty_multiplier=float(qty_cfg.get("AVOID", 0.0)),
    )


def signal_config_to_dict(cfg: SignalConfigV1) -> dict:
    """
    Convenience helper for inspecting or exporting the signal configuration.
    """
    return asdict(cfg)

