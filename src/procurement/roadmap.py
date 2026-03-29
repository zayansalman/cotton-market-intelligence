from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import TYPE_CHECKING, Literal

import numpy as np
import pandas as pd

if TYPE_CHECKING:
    from ..buy_rules import BuySignal

BuySignalLike = Literal["STRONG_BUY", "BUY", "HOLD", "AVOID"]


@dataclass
class ProcurementTarget:
    """Commercial need: total cotton to secure within a forward horizon."""

    total_tonnes: float
    horizon_months: int
    label: str = ""
    start_date: date | None = None


@dataclass
class Tranche:
    """One period (e.g. month) within the roadmap."""

    index: int
    period_start: date
    period_end: date
    target_tonnes: float
    weight: float
    note: str = ""


@dataclass
class ProcurementRoadmap:
    tranches: list[Tranche]
    total_tonnes: float
    horizon_months: int
    signal_used: str
    vol_ratio: float
    news_tilt: float
    meta: dict = field(default_factory=dict)


@dataclass
class RoadmapConfig:
    """Tuning for how aggressively to front-load or spread purchases."""

    front_load_decay: float = 0.18  # higher = steeper front-load when buying
    back_load_growth: float = 0.14  # when avoiding / delaying
    vol_flatten_power: float = 0.55  # blend toward uniform when vol is high
    news_front_bias: float = 0.25  # how much news shifts timing


def build_procurement_roadmap(
    target: ProcurementTarget,
    signal: BuySignalLike,
    *,
    vol_ratio: float = 1.0,
    news_timing_tilt: float = 0.0,
    config: RoadmapConfig | None = None,
) -> ProcurementRoadmap:
    """
    Build a month-by-month purchase roadmap that sums to ``target.total_tonnes``.

    Parameters
    ----------
    target
        Total tonnes and horizon in months.
    signal
        Current value/vol/momentum classification — drives front-load vs delay.
    vol_ratio
        Recent vol / median vol (>1 means elevated uncertainty → flatten schedule).
    news_timing_tilt
        -1 = narrative favours delaying purchases; +1 = favours accelerating.
    """
    if config is None:
        config = RoadmapConfig()
    if target.horizon_months < 1:
        raise ValueError("horizon_months must be >= 1")
    if target.total_tonnes <= 0:
        raise ValueError("total_tonnes must be positive")

    n = target.horizon_months
    start_ts = pd.Timestamp(target.start_date or date.today()).normalize()

    # Base weights: signal-dependent shape
    t = np.arange(n, dtype=float)
    if signal in ("STRONG_BUY", "BUY"):
        w = np.exp(-config.front_load_decay * t)
    elif signal == "AVOID":
        w = np.exp(config.back_load_growth * t)
    else:
        w = np.ones(n)

    # News: shift mass earlier (positive tilt) or later (negative tilt)
    tilt = np.clip(news_timing_tilt, -1.0, 1.0)
    if abs(tilt) > 1e-6:
        shift = np.exp(-tilt * config.news_front_bias * (np.arange(n) - (n - 1) / 2.0))
        w = w * shift

    # High vol → dollar-cost-average (closer to uniform)
    vr = float(np.clip(vol_ratio, 0.5, 5.0))
    uniform = np.ones(n) / n
    blend = np.clip((vr - 1.0) / 2.0, 0.0, 1.0)  # 0 at vr=1, up to 1 by vr=3
    w = (1.0 - blend**config.vol_flatten_power) * w + blend**config.vol_flatten_power * uniform * n
    w = np.maximum(w, 1e-9)
    w = w / w.sum()

    tonnes = w * target.total_tonnes

    periods = pd.period_range(start=start_ts, periods=n, freq="M")
    tranches: list[Tranche] = []
    for i in range(n):
        p = periods[i]
        month_start = p.start_time.date()
        month_end = p.end_time.date()
        note = ""
        if signal == "STRONG_BUY" and i < 2:
            note = "Front-loaded: strong value signal."
        elif signal == "AVOID" and i >= n - 2:
            note = "Back-loaded: expensive regime; minimise early exposure."
        elif blend > 0.35:
            note = "Smoothed: elevated volatility — spread risk."

        tranches.append(
            Tranche(
                index=i,
                period_start=month_start,
                period_end=month_end,
                target_tonnes=float(tonnes[i]),
                weight=float(w[i]),
                note=note,
            )
        )

    return ProcurementRoadmap(
        tranches=tranches,
        total_tonnes=target.total_tonnes,
        horizon_months=n,
        signal_used=signal,
        vol_ratio=vol_ratio,
        news_tilt=news_timing_tilt,
        meta={"weights": w.tolist(), "vol_flatten_blend": float(blend)},
    )
