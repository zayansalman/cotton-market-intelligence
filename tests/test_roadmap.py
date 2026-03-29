"""Tests for procurement roadmap — actual business logic, no external data."""
from __future__ import annotations

import math

import pytest

from src.procurement.roadmap import (
    ProcurementTarget,
    RoadmapConfig,
    build_procurement_roadmap,
)


def _make_target(tonnes: float = 5000.0, months: int = 6) -> ProcurementTarget:
    return ProcurementTarget(total_tonnes=tonnes, horizon_months=months, label="test")


class TestRoadmapTonnageSumsCorrectly:
    @pytest.mark.parametrize("signal", ["STRONG_BUY", "BUY", "HOLD", "AVOID"])
    def test_total_matches_target(self, signal: str) -> None:
        rm = build_procurement_roadmap(_make_target(5000, 6), signal)
        total = sum(t.target_tonnes for t in rm.tranches)
        assert math.isclose(total, 5000.0, rel_tol=1e-6)

    def test_single_month(self) -> None:
        rm = build_procurement_roadmap(_make_target(1000, 1), "HOLD")
        assert len(rm.tranches) == 1
        assert math.isclose(rm.tranches[0].target_tonnes, 1000.0, rel_tol=1e-6)


class TestSignalShapesBehavior:
    def test_strong_buy_front_loads(self) -> None:
        rm = build_procurement_roadmap(_make_target(6000, 6), "STRONG_BUY")
        assert rm.tranches[0].target_tonnes > rm.tranches[-1].target_tonnes

    def test_avoid_back_loads(self) -> None:
        rm = build_procurement_roadmap(_make_target(6000, 6), "AVOID")
        assert rm.tranches[-1].target_tonnes > rm.tranches[0].target_tonnes

    def test_hold_roughly_uniform(self) -> None:
        rm = build_procurement_roadmap(_make_target(6000, 6), "HOLD")
        weights = [t.weight for t in rm.tranches]
        assert max(weights) - min(weights) < 0.05


class TestVolatilityFlattens:
    def test_high_vol_flattens_schedule(self) -> None:
        rm_low = build_procurement_roadmap(_make_target(), "STRONG_BUY", vol_ratio=0.8)
        rm_high = build_procurement_roadmap(_make_target(), "STRONG_BUY", vol_ratio=3.0)
        spread_low = rm_low.tranches[0].weight - rm_low.tranches[-1].weight
        spread_high = rm_high.tranches[0].weight - rm_high.tranches[-1].weight
        assert spread_high < spread_low


class TestNewsTilt:
    def test_positive_tilt_pulls_forward(self) -> None:
        rm_neutral = build_procurement_roadmap(_make_target(), "HOLD", news_timing_tilt=0.0)
        rm_tilt = build_procurement_roadmap(_make_target(), "HOLD", news_timing_tilt=0.8)
        assert rm_tilt.tranches[0].target_tonnes > rm_neutral.tranches[0].target_tonnes


class TestEdgeCases:
    def test_zero_tonnes_raises(self) -> None:
        with pytest.raises(ValueError):
            build_procurement_roadmap(_make_target(0, 6), "HOLD")

    def test_zero_months_raises(self) -> None:
        with pytest.raises(ValueError):
            build_procurement_roadmap(_make_target(5000, 0), "HOLD")

    def test_all_weights_positive(self) -> None:
        rm = build_procurement_roadmap(_make_target(), "AVOID", vol_ratio=4.0, news_timing_tilt=-0.9)
        for t in rm.tranches:
            assert t.target_tonnes > 0
            assert t.weight > 0
