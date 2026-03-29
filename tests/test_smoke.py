"""Smoke tests for CI (no external data required)."""
from __future__ import annotations


def test_pipeline_snapshot_without_data():
    from src.pipeline_snapshot import build_pipeline_snapshot

    snap = build_pipeline_snapshot()
    assert "stages" in snap
    assert isinstance(snap["stages"], list)
    assert snap.get("plan") is None
    assert any(s["id"] == "data" for s in snap["stages"])
