"""
Cotton Market Intelligence — pipeline dashboard (Streamlit).

Runs in Docker/CI/cloud; reads optional snapshot from artifacts/ or regenerates.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import streamlit as st

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

SNAPSHOT_ENV = "CMI_PIPELINE_SNAPSHOT"
DEFAULT_SNAPSHOT = REPO_ROOT / "artifacts" / "pipeline_snapshot.json"


@st.cache_data(ttl=30)
def load_snapshot() -> dict:
    p = os.getenv(SNAPSHOT_ENV, str(DEFAULT_SNAPSHOT))
    path = Path(p)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    try:
        from src.pipeline_snapshot import build_pipeline_snapshot

        return build_pipeline_snapshot()
    except Exception as e:
        return {
            "generated_at": "",
            "ci": {},
            "stages": [
                {
                    "id": "error",
                    "name": "Snapshot",
                    "status": "error",
                    "detail": str(e),
                    "meta": {},
                }
            ],
            "plan": None,
            "error": str(e),
        }


def status_emoji(status: str) -> str:
    return {
        "ok": "🟢",
        "warn": "🟡",
        "error": "🔴",
        "skipped": "⚪",
    }.get(status, "⚫")


def main() -> None:
    st.set_page_config(
        page_title="CMI Pipeline",
        layout="wide",
        initial_sidebar_state="expanded",
    )

    st.title("Cotton Market Intelligence — pipeline")
    st.caption(
        "Enterprise DLC view: config → data → benchmarks → signal → news/NLP → roadmap → narrative"
    )

    snap = load_snapshot()
    ci = snap.get("ci") or {}

    with st.sidebar:
        st.subheader("CI / Git context")
        st.text(f"Ref: {ci.get('ref') or '—'}")
        st.text(f"SHA: {ci.get('sha') or '—'}")
        st.text(f"Run: {ci.get('run_id') or '—'}")
        st.text(f"Workflow: {ci.get('workflow') or '—'}")
        st.divider()
        st.caption("Snapshot path")
        st.code(os.getenv(SNAPSHOT_ENV, str(DEFAULT_SNAPSHOT)), language="text")
        if st.button("Refresh snapshot"):
            load_snapshot.clear()
            st.rerun()

    col1, col2 = st.columns([1, 2])

    with col1:
        st.subheader("Stages")
        for s in snap.get("stages", []):
            with st.container():
                st.markdown(
                    f"**{status_emoji(s.get('status', ''))} {s.get('name', s.get('id'))}**  "
                    f"`{s.get('status', '')}`"
                )
                if s.get("detail"):
                    st.caption(s["detail"])
                if s.get("meta"):
                    with st.expander("meta"):
                        st.json(s["meta"])

    with col2:
        st.subheader("Roadmap (if data available)")
        plan = snap.get("plan")
        if plan:
            st.metric("Signal", plan.get("signal", "—"))
            st.metric("Target", f"{plan.get('target_tonnes', 0):,.0f} t / {plan.get('horizon_months', 0)} mo")
            rm = plan.get("roadmap") or []
            if rm:
                import pandas as pd

                df = pd.DataFrame(rm)
                st.dataframe(df, use_container_width=True, hide_index=True)
                try:
                    import plotly.express as px

                    fig = px.bar(
                        df,
                        x="month",
                        y="tonnes",
                        title="Monthly tranche (tonnes)",
                    )
                    st.plotly_chart(fig, use_container_width=True)
                except Exception:
                    pass
            n = plan.get("news") or {}
            st.markdown("**News blend**")
            st.json(
                {
                    "sentiment": n.get("sentiment"),
                    "keyword": n.get("keyword_sentiment"),
                    "hf": n.get("hf_sentiment"),
                    "model": n.get("hf_model"),
                }
            )
        else:
            st.info(
                "No full plan in snapshot. Mount CSV and set "
                "`COTTON_DAILY_DATA_LOCAL_FILEPATH`, then run "
                "`python -m scripts.write_pipeline_snapshot` or CI artifact step."
            )

    st.divider()
    st.subheader("Where we are (DLC)")
    st.markdown(
        """
| Stage | Owner | Automation |
|-------|--------|------------|
| **Plan** | Product | Roadmap in wiki |
| **Build** | Dev | PR → CI lint + tests + Docker build |
| **Verify** | QA / CI | `pytest`, snapshot artifact |
| **Release** | Ops | Tag → image (optional GHCR) |
| **Monitor** | SRE | This dashboard + logs |
"""
    )

    with st.expander("Raw snapshot JSON"):
        st.json(snap)


if __name__ == "__main__":
    main()
