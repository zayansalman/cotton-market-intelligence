"""Tests for HF NLP module — logic tests that don't require model downloads."""
from __future__ import annotations

import os

from src.intelligence.hf_nlp import (
    _finbert_label_to_buyer_stress,
    _multilingual_star_to_stress,
    blend_scores,
)


class TestFinbertLabelMapping:
    def test_positive_label_is_positive(self) -> None:
        assert _finbert_label_to_buyer_stress({"label": "positive", "score": 0.9}) > 0

    def test_negative_label_is_negative(self) -> None:
        assert _finbert_label_to_buyer_stress({"label": "negative", "score": 0.9}) < 0

    def test_neutral_is_zero(self) -> None:
        assert _finbert_label_to_buyer_stress({"label": "neutral", "score": 0.9}) == 0.0


class TestMultilingualStarMapping:
    def test_1_star_is_very_negative(self) -> None:
        assert _multilingual_star_to_stress({"label": "1 star", "score": 0.95}) < -0.5

    def test_5_star_is_positive(self) -> None:
        assert _multilingual_star_to_stress({"label": "5 stars", "score": 0.8}) > 0.5

    def test_3_star_is_neutral(self) -> None:
        assert _multilingual_star_to_stress({"label": "3 stars", "score": 0.7}) == 0.0


class TestBlending:
    def test_keyword_only_when_hf_none(self) -> None:
        assert blend_scores(keyword=-0.5, hf=None) == -0.5

    def test_blend_weights_apply(self) -> None:
        result = blend_scores(keyword=0.0, hf=1.0)
        assert 0.5 < result < 0.8  # 0.65 weight on HF

    def test_equal_inputs_return_same(self) -> None:
        assert blend_scores(keyword=0.3, hf=0.3) == pytest.approx(0.3)


import pytest
