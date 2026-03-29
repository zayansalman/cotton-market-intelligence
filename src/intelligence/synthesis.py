from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import Any

from .news import NewsDigest


@dataclass
class StrategicNarrative:
    """Human-readable strategy + machine-readable fields for audit."""

    executive_summary: str
    procurement_rationale: str
    risk_factors: list[str] = field(default_factory=list)
    next_actions: list[str] = field(default_factory=list)
    raw_model: str | None = None


def _heuristic_narrative(
    *,
    company: str,
    total_tonnes: float,
    horizon_months: int,
    signal: str,
    value_rank: float,
    vol_ratio: float,
    news: NewsDigest,
) -> StrategicNarrative:
    vr = f"{vol_ratio:.2f}" if vol_ratio == vol_ratio else "n/a"
    vr_msg = (
        "Realized volatility is elevated versus its own history; favour spreading purchases "
        "rather than concentrating in a few days."
        if (vol_ratio == vol_ratio and vol_ratio > 1.4)
        else "Volatility regime is closer to normal; timing flexibility is higher."
    )
    ns = news.sentiment_score
    news_msg = (
        "Recent headlines skew toward supply/tightness risk — bias toward earlier cover or wider buffers."
        if ns < -0.15
        else (
            "Headlines skew toward softer/looser market narratives — more room to delay or scale in."
            if ns > 0.15
            else "Headline scan is neutral on direction; lean on price signals and volatility."
        )
    )
    sig_msg = {
        "STRONG_BUY": "Price screens cheap versus its own 1Y history; prioritise building inventory subject to risk limits.",
        "BUY": "Price is moderately attractive; increase pacing versus baseline.",
        "HOLD": "Price is not a clear opportunity; keep baseline cadence and revisit on signal change.",
        "AVOID": "Price screens expensive versus history; minimise incremental exposure and push weight later in the horizon.",
    }.get(signal, "Review signals.")

    hf_note = ""
    if news.hf_model_id:
        hf_note = (
            f" NLP layer: {news.hf_model_id} (HF={news.hf_sentiment_score:.2f} blended with "
            f"keyword={news.keyword_sentiment_score:.2f})."
            if news.hf_sentiment_score is not None
            else f" NLP layer: {news.hf_model_id}."
        )
    exec_sum = (
        f"{company} needs {total_tonnes:,.0f} tonnes over {horizon_months} months. "
        f"Current model signal is {signal} (value rank ≈ {value_rank:.2f}). "
        f"{sig_msg} {vr_msg} {news_msg}{hf_note}"
    )
    risk = []
    if vol_ratio == vol_ratio and vol_ratio > 1.6:
        risk.append("Elevated short-term volatility — execution risk on large single tickets.")
    if ns < -0.2:
        risk.append("News flow suggests upside risk to price; confirm origin and quality assumptions.")
    if value_rank > 0.7:
        risk.append("Spot is historically rich — basis and origin premia may dominate headline index.")

    actions = [
        "Confirm quality mix (Ne counts) and wastage assumptions for tonnage conversion.",
        "Align roadmap tranches with internal credit limits and warehouse capacity.",
        "Set review triggers: weekly signal refresh + headline scan for regime change.",
    ]
    return StrategicNarrative(
        executive_summary=exec_sum,
        procurement_rationale=(
            "Roadmap weights combine (1) value/volatility signals, (2) optional news timing tilt, "
            "and (3) risk smoothing under high volatility — see procurement module meta weights."
        ),
        risk_factors=risk,
        next_actions=actions,
        raw_model=None,
    )


def synthesize_strategy(
    *,
    company: str,
    total_tonnes: float,
    horizon_months: int,
    signal: str,
    value_rank: float,
    vol_ratio: float,
    news: NewsDigest,
) -> StrategicNarrative:
    """
    Produce an executive narrative. If ``OPENAI_API_KEY`` is set, optionally call OpenAI;
    otherwise use deterministic heuristic text (auditable, reproducible).
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if api_key:
        try:
            return _openai_narrative(
                api_key=api_key,
                company=company,
                total_tonnes=total_tonnes,
                horizon_months=horizon_months,
                signal=signal,
                value_rank=value_rank,
                vol_ratio=vol_ratio,
                news=news,
            )
        except OSError:
            pass
        except Exception:
            pass
    return _heuristic_narrative(
        company=company,
        total_tonnes=total_tonnes,
        horizon_months=horizon_months,
        signal=signal,
        value_rank=value_rank,
        vol_ratio=vol_ratio,
        news=news,
    )


def _openai_narrative(
    api_key: str,
    *,
    company: str,
    total_tonnes: float,
    horizon_months: int,
    signal: str,
    value_rank: float,
    vol_ratio: float,
    news: NewsDigest,
) -> StrategicNarrative:
    import urllib.request

    headlines = [n.title for n in news.items[:8]]
    payload = {
        "model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a senior cotton procurement strategist for spinning mills. "
                    "Be precise, non-hype, and risk-aware. Output structured JSON only."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "company": company,
                        "total_tonnes": total_tonnes,
                        "horizon_months": horizon_months,
                        "signal": signal,
                        "value_percentile_rank_1y": value_rank,
                        "vol_ratio": vol_ratio,
                        "news_sentiment_blended": news.sentiment_score,
                        "news_keyword_sentiment": news.keyword_sentiment_score,
                        "news_hf_sentiment": news.hf_sentiment_score,
                        "news_hf_model": news.hf_model_id,
                        "headlines": headlines,
                    }
                ),
            },
            {
                "role": "user",
                "content": (
                    'Return JSON with keys: executive_summary (string), procurement_rationale (string), '
                    'risk_factors (array of strings), next_actions (array of strings).'
                ),
            },
        ],
        "temperature": 0.3,
    }
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    text = data["choices"][0]["message"]["content"].strip()
    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", text)
        if not m:
            raise
        obj = json.loads(m.group(0))
    return StrategicNarrative(
        executive_summary=obj.get("executive_summary", ""),
        procurement_rationale=obj.get("procurement_rationale", ""),
        risk_factors=list(obj.get("risk_factors", [])),
        next_actions=list(obj.get("next_actions", [])),
        raw_model="openai",
    )
