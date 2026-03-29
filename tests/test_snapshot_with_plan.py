"""Test pipeline_snapshot stages structure and plan_to_dict serialisation."""
from __future__ import annotations

from src.pipeline_snapshot import build_pipeline_snapshot


def test_all_stages_present_without_data() -> None:
    snap = build_pipeline_snapshot()
    ids = [s["id"] for s in snap["stages"]]
    assert "config" in ids
    assert "data" in ids
    assert "benchmarks" in ids
    assert "signal" in ids
    assert "news" in ids
    assert "roadmap" in ids
    assert "narrative" in ids


def test_config_stage_ok() -> None:
    snap = build_pipeline_snapshot()
    cfg = next(s for s in snap["stages"] if s["id"] == "config")
    assert cfg["status"] == "ok"


def test_data_stage_skipped_without_csv() -> None:
    snap = build_pipeline_snapshot()
    data = next(s for s in snap["stages"] if s["id"] == "data")
    assert data["status"] == "skipped"


def test_generated_at_populated() -> None:
    snap = build_pipeline_snapshot()
    assert snap["generated_at"]
    assert "T" in snap["generated_at"]
