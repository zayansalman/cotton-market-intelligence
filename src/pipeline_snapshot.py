"""
Machine-readable pipeline status for dashboards and CI artifacts.

Safe to import without data: returns stage metadata and optional full plan JSON.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent


def _ci_meta() -> dict[str, Any]:
    return {
        "ref": os.getenv("GITHUB_REF", ""),
        "sha": os.getenv("GITHUB_SHA", "")[:7] if os.getenv("GITHUB_SHA") else "",
        "run_id": os.getenv("GITHUB_RUN_ID", ""),
        "workflow": os.getenv("GITHUB_WORKFLOW", ""),
        "actor": os.getenv("GITHUB_ACTOR", ""),
        "server_url": os.getenv("GITHUB_SERVER_URL", ""),
    }


def build_pipeline_snapshot(
    *,
    company: str = "Pipeline Demo",
    total_tonnes: float = 5000.0,
    horizon_months: int = 6,
    macrotrends_csv: str | Path | None = None,
) -> dict[str, Any]:
    """
    Run all stages where possible; mark failures without raising (for CI/dashboard).
    """
    stages: list[dict[str, Any]] = []

    def add_stage(
        sid: str, name: str, status: str, detail: str = "", meta: dict[str, Any] | None = None
    ) -> None:
        stages.append(
            {
                "id": sid,
                "name": name,
                "status": status,  # ok | warn | error | skipped
                "detail": detail,
                "meta": meta or {},
            }
        )

    root = REPO_ROOT
    signal_path = root / "config" / "signals.yml"
    mill_path = root / "config" / "mill_profiles.yml"
    news_path = root / "config" / "news_feeds.yml"

    add_stage(
        "config",
        "Configuration (YAML)",
        "ok" if signal_path.exists() and mill_path.exists() else "error",
        "signals.yml + mill_profiles.yml",
        {"signals": str(signal_path), "mills": str(mill_path), "news": str(news_path)},
    )

    csv = macrotrends_csv or os.getenv("COTTON_DAILY_DATA_LOCAL_FILEPATH", "")
    p = Path(csv) if csv else None
    data_ok = p is not None and p.exists()
    add_stage(
        "data",
        "Price data (MacroTrends CSV)",
        "ok" if data_ok else "skipped",
        str(p) if p else "Set COTTON_DAILY_DATA_LOCAL_FILEPATH or mount CSV in container",
    )

    plan_dict: dict[str, Any] | None = None
    error: str | None = None

    if data_ok and p is not None:
        try:
            from .strategic import build_strategic_procurement_plan, plan_to_dict

            wb = os.getenv("WB_COMMODITIES_DATA_LOCAL_FILEPATH", "")
            wb_path = Path(wb) if wb and Path(wb).exists() else None

            plan = build_strategic_procurement_plan(
                company=company,
                total_tonnes=total_tonnes,
                horizon_months=horizon_months,
                macrotrends_csv=p,
                worldbank_xlsx=wb_path,
            )
            plan_dict = plan_to_dict(plan)

            add_stage("benchmarks", "Benchmarks & spot snapshot", "ok", "value rank, vol, z-scores")
            add_stage("signal", "Buy signal", "ok", plan_dict.get("signal", ""))
            add_stage(
                "news",
                "News + NLP",
                "ok",
                f"sentiment={plan_dict.get('news', {}).get('sentiment', 0):.3f}",
            )
            add_stage("roadmap", "Procurement roadmap", "ok", f"{horizon_months} months")
            add_stage("narrative", "Strategy narrative", "ok", "heuristic or OpenAI")
        except Exception as e:
            error = str(e)
            add_stage("pipeline", "End-to-end strategic plan", "error", error)
    else:
        add_stage("benchmarks", "Benchmarks & spot snapshot", "skipped", "No CSV")
        add_stage("signal", "Buy signal", "skipped", "No CSV")
        add_stage("news", "News + NLP", "skipped", "No CSV or partial")
        add_stage("roadmap", "Procurement roadmap", "skipped", "No CSV")
        add_stage("narrative", "Strategy narrative", "skipped", "No CSV")

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "ci": _ci_meta(),
        "stages": stages,
        "plan": plan_dict,
        "error": error,
    }


def write_snapshot(path: str | Path, **kwargs: Any) -> Path:
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    snap = build_pipeline_snapshot(**kwargs)
    out.write_text(json.dumps(snap, indent=2), encoding="utf-8")
    return out


__all__ = ["build_pipeline_snapshot", "write_snapshot"]
