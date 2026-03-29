"""Tests for heuristic narrative generation — no API key needed."""
from __future__ import annotations

from src.intelligence.news import NewsDigest
from src.intelligence.synthesis import _heuristic_narrative, synthesize_strategy


def _make_news(sentiment: float = 0.0, hf: float | None = None) -> NewsDigest:
    return NewsDigest(
        items=[],
        sentiment_score=sentiment,
        keyword_sentiment_score=sentiment,
        hf_sentiment_score=hf,
        hf_model_id="test/model" if hf is not None else None,
    )


class TestHeuristicNarrative:
    def test_strong_buy_mentions_cheap(self) -> None:
        n = _heuristic_narrative(
            company="TestMill",
            total_tonnes=5000,
            horizon_months=6,
            signal="STRONG_BUY",
            value_rank=0.10,
            vol_ratio=1.0,
            news=_make_news(),
        )
        assert "cheap" in n.executive_summary.lower()
        assert n.procurement_rationale

    def test_avoid_mentions_expensive(self) -> None:
        n = _heuristic_narrative(
            company="TestMill",
            total_tonnes=3000,
            horizon_months=3,
            signal="AVOID",
            value_rank=0.85,
            vol_ratio=1.0,
            news=_make_news(),
        )
        assert "expensive" in n.executive_summary.lower()

    def test_high_vol_adds_risk_factor(self) -> None:
        n = _heuristic_narrative(
            company="X",
            total_tonnes=1000,
            horizon_months=2,
            signal="HOLD",
            value_rank=0.50,
            vol_ratio=2.0,
            news=_make_news(),
        )
        assert any("volatility" in r.lower() for r in n.risk_factors)

    def test_bearish_news_adds_risk_factor(self) -> None:
        n = _heuristic_narrative(
            company="X",
            total_tonnes=1000,
            horizon_months=2,
            signal="HOLD",
            value_rank=0.50,
            vol_ratio=1.0,
            news=_make_news(sentiment=-0.4),
        )
        assert any("news" in r.lower() or "upside risk" in r.lower() for r in n.risk_factors)

    def test_hf_note_appears_when_model_set(self) -> None:
        n = _heuristic_narrative(
            company="X",
            total_tonnes=1000,
            horizon_months=2,
            signal="HOLD",
            value_rank=0.50,
            vol_ratio=1.0,
            news=_make_news(sentiment=0.1, hf=0.05),
        )
        assert "NLP layer" in n.executive_summary
        assert "test/model" in n.executive_summary

    def test_next_actions_not_empty(self) -> None:
        n = _heuristic_narrative(
            company="X",
            total_tonnes=1000,
            horizon_months=1,
            signal="BUY",
            value_rank=0.20,
            vol_ratio=1.0,
            news=_make_news(),
        )
        assert len(n.next_actions) >= 2


class TestSynthesizeStrategy:
    def test_falls_back_to_heuristic_without_api_key(self) -> None:
        n = synthesize_strategy(
            company="FallbackTest",
            total_tonnes=2000,
            horizon_months=4,
            signal="HOLD",
            value_rank=0.50,
            vol_ratio=1.0,
            news=_make_news(),
        )
        assert n.raw_model is None
        assert "FallbackTest" in n.executive_summary
