"""Tests for buy rule decision logic — no external data needed."""
from __future__ import annotations

import pytest

from src.buy_rules import BuyDecision, SignalConfig, decide_buy


def _components(
    *,
    value_rank: float = 0.5,
    vol_30d: float = 0.015,
    vol_30d_median: float = 0.015,
    momentum_ok: float = 1.0,
) -> dict[str, float]:
    return {
        "current_price": 0.80,
        "value_pct_rank_252d": value_rank,
        "z_90d": -0.3,
        "z_252d": -0.2,
        "vol_30d": vol_30d,
        "vol_30d_median": vol_30d_median,
        "momentum_ok": momentum_ok,
    }


class TestValueRankDrivesSignal:
    def test_cheap_with_momentum_is_strong_buy(self) -> None:
        d = decide_buy(_components(value_rank=0.10), base_qty_tons=100)
        assert d.signal == "STRONG_BUY"

    def test_moderate_cheap_is_buy(self) -> None:
        d = decide_buy(_components(value_rank=0.20), base_qty_tons=100)
        assert d.signal == "BUY"

    def test_mid_range_is_hold(self) -> None:
        d = decide_buy(_components(value_rank=0.50), base_qty_tons=100)
        assert d.signal == "HOLD"

    def test_expensive_is_avoid(self) -> None:
        d = decide_buy(_components(value_rank=0.80), base_qty_tons=100)
        assert d.signal == "AVOID"


class TestVolOverridesCheapSignal:
    def test_high_vol_downgrades_buy_to_hold(self) -> None:
        cfg = SignalConfig(max_vol_30d_multiple_of_median=2.0)
        d = decide_buy(
            _components(value_rank=0.10, vol_30d=0.05, vol_30d_median=0.015),
            base_qty_tons=100,
            config=cfg,
        )
        assert d.signal == "HOLD"


class TestQuantityScaling:
    def test_strong_buy_scales_up(self) -> None:
        d = decide_buy(_components(value_rank=0.10), base_qty_tons=100)
        assert d.suggested_qty_tons == 150.0  # default 1.5x

    def test_hold_is_zero(self) -> None:
        d = decide_buy(_components(value_rank=0.50), base_qty_tons=100)
        assert d.suggested_qty_tons == 0.0  # default hold multiplier = 0

    def test_avoid_is_zero(self) -> None:
        d = decide_buy(_components(value_rank=0.80), base_qty_tons=100)
        assert d.suggested_qty_tons == 0.0


class TestMissingData:
    def test_nan_rank_gives_hold(self) -> None:
        d = decide_buy(_components(value_rank=float("nan")), base_qty_tons=100)
        assert d.signal == "HOLD"
