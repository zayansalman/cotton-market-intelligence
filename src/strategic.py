"""
Strategic cotton procurement: combine price signals, volatility, news, and optional LLM narrative
into a month-by-month roadmap for a stated tonnage over a forward horizon.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .benchmarks import BenchmarksConfig, compute_price_benchmarks, evaluate_spot_snapshot
from .buy_rules import BuyDecision, SignalConfig, generate_signal_for_date
from .capacity import MillProfile
from .cotton_prices import PriceLoadConfig, load_cotton_prices
from .config_loader import load_mill_profiles, load_signal_config
from .intelligence.news import NewsDigest, fetch_news_digest, load_feed_urls_from_yaml
from .intelligence.synthesis import StrategicNarrative, synthesize_strategy
from .procurement.roadmap import ProcurementRoadmap, ProcurementTarget, build_procurement_roadmap


@dataclass
class StrategicProcurementPlan:
    """Full output for a commercial cotton need (X tonnes in Y months)."""

    company: str
    target: ProcurementTarget
    buy_decision: BuyDecision
    roadmap: ProcurementRoadmap
    news: NewsDigest
    narrative: StrategicNarrative
    snapshot: dict = field(default_factory=dict)


def build_strategic_procurement_plan(
    *,
    company: str,
    total_tonnes: float,
    horizon_months: int,
    macrotrends_csv: str | Path,
    mill_profile_name: str | None = None,
    worldbank_xlsx: str | Path | None = None,
    news_feeds_yaml: str | Path | None = None,
    signal_config_path: str | Path | None = None,
    mill_profiles_path: str | Path | None = None,
) -> StrategicProcurementPlan:
    """
    End-to-end: load prices → benchmarks → buy signal → news digest → roadmap → narrative.

    ``total_tonnes`` and ``horizon_months`` describe the commercial need (e.g. 5000 t in 6 months).
    Mill profile scales *near-term* suggested order from ``generate_signal_for_date``; the roadmap
    allocates the full ``total_tonnes`` across months.
    """
    root = Path(__file__).resolve().parent.parent
    if signal_config_path is None:
        signal_config_path = root / "config" / "signals.yml"
    if mill_profiles_path is None:
        mill_profiles_path = root / "config" / "mill_profiles.yml"
    if news_feeds_yaml is None:
        news_feeds_yaml = root / "config" / "news_feeds.yml"

    wb = str(worldbank_xlsx) if worldbank_xlsx and Path(worldbank_xlsx).exists() else None

    prices = load_cotton_prices(
        PriceLoadConfig(
            macrotrends_csv_path=str(macrotrends_csv),
            worldbank_xlsx_path=wb,
            fred_codes={"CPI": "CPIAUCSL"},
        )
    )
    prices_bm = compute_price_benchmarks(prices, config=BenchmarksConfig())
    snap = evaluate_spot_snapshot(prices_bm)
    value_rank = float(snap.get("value_pct_rank_252d", float("nan")))
    vol_30d = float(snap.get("vol_30d", float("nan")))
    vol_hist = prices_bm["vol_30d"].dropna()
    vol_med = float(vol_hist.median()) if not vol_hist.empty else float("nan")
    vol_ratio = vol_30d / vol_med if (vol_med == vol_med and vol_med > 0) else 1.0

    profiles = load_mill_profiles(mill_profiles_path)
    if mill_profile_name and mill_profile_name in profiles:
        mill = profiles[mill_profile_name]
    else:
        mill = next(iter(profiles.values()))

    sig_cfg = load_signal_config(signal_config_path)
    decision = generate_signal_for_date(prices_bm, profile=mill, config=sig_cfg)

    urls = load_feed_urls_from_yaml(news_feeds_yaml)
    news = (
        fetch_news_digest(urls)
        if urls
        else NewsDigest(
            items=[],
            sentiment_score=0.0,
            keyword_sentiment_score=0.0,
            hf_sentiment_score=None,
            hf_model_id=None,
        )
    )

    # Map news sentiment to timing tilt: bearish headline flow → accelerate cover
    news_tilt = -news.sentiment_score * 0.85

    roadmap = build_procurement_roadmap(
        ProcurementTarget(
            total_tonnes=total_tonnes,
            horizon_months=horizon_months,
            label=company,
        ),
        signal=decision.signal,
        vol_ratio=vol_ratio,
        news_timing_tilt=news_tilt,
    )

    narrative = synthesize_strategy(
        company=company,
        total_tonnes=total_tonnes,
        horizon_months=horizon_months,
        signal=decision.signal,
        value_rank=value_rank,
        vol_ratio=vol_ratio,
        news=news,
    )

    return StrategicProcurementPlan(
        company=company,
        target=ProcurementTarget(
            total_tonnes=total_tonnes,
            horizon_months=horizon_months,
            label=company,
        ),
        buy_decision=decision,
        roadmap=roadmap,
        news=news,
        narrative=narrative,
        snapshot=snap,
    )


def plan_to_dict(plan: StrategicProcurementPlan) -> dict:
    """Serialize for CLI / API / audit logs."""
    return {
        "company": plan.company,
        "target_tonnes": plan.target.total_tonnes,
        "horizon_months": plan.target.horizon_months,
        "signal": plan.buy_decision.signal,
        "suggested_near_term_tons": plan.buy_decision.suggested_qty_tons,
        "roadmap": [
            {
                "month": t.index + 1,
                "start": str(t.period_start),
                "end": str(t.period_end),
                "tonnes": round(t.target_tonnes, 2),
                "weight": round(t.weight, 4),
                "note": t.note,
            }
            for t in plan.roadmap.tranches
        ],
        "news": {
            "sentiment": plan.news.sentiment_score,
            "keyword_sentiment": plan.news.keyword_sentiment_score,
            "hf_sentiment": plan.news.hf_sentiment_score,
            "hf_model": plan.news.hf_model_id,
            "relevance_ranked": plan.news.relevance_ranked,
            "sources": plan.news.sources_fetched,
            "headlines": [i.title for i in plan.news.items[:8]],
        },
        "narrative": {
            "executive_summary": plan.narrative.executive_summary,
            "procurement_rationale": plan.narrative.procurement_rationale,
            "risk_factors": plan.narrative.risk_factors,
            "next_actions": plan.narrative.next_actions,
        },
        "benchmarks_snapshot": {k: v for k, v in plan.snapshot.items() if isinstance(v, (int, float, str))},
    }


__all__ = [
    "StrategicProcurementPlan",
    "build_strategic_procurement_plan",
    "plan_to_dict",
]
