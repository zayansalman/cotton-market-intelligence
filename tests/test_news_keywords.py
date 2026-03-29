"""Tests for keyword-based news scoring (no network, no HF)."""
from __future__ import annotations

from src.intelligence.news import _score_text


class TestKeywordScoring:
    def test_bearish_keywords_go_negative(self) -> None:
        score, hits = _score_text("Cotton drought causes shortage in supply chain")
        assert score < 0
        assert any("bearish" in k for k in hits)

    def test_bullish_keywords_go_positive(self) -> None:
        score, hits = _score_text("Bumper cotton crop leads to oversupply and lower prices")
        assert score > 0
        assert any("bullish" in k for k in hits)

    def test_neutral_text_is_zero(self) -> None:
        score, hits = _score_text("The committee held a meeting on Tuesday")
        assert score == 0.0
        assert len(hits) == 0

    def test_score_clamped_to_bounds(self) -> None:
        extreme = " ".join(["drought shortage freeze war sanction strike embargo"] * 10)
        score, _ = _score_text(extreme)
        assert -1.0 <= score <= 1.0
