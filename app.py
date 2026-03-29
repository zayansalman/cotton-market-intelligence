"""
Cotton Market Intelligence — AI-Native Procurement Advisor

Single-file Streamlit app. Zero infrastructure.
Deploy to Streamlit Community Cloud: https://share.streamlit.io

Only secret needed: OPENAI_API_KEY (set in Streamlit Cloud secrets or .env)
Without it, the app still runs with statistical heuristics.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request
from datetime import datetime

import feedparser
import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
import yfinance as yf

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# CONFIG
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RSS_FEEDS = [
    "https://www.cottongrower.com/feed/",
    "https://www.textileworld.com/feed/",
    "https://www.usda.gov/rss/latest-news.xml",
    "https://blogs.worldbank.org/en/topic/agriculture/rss.xml",
]

SYSTEM_PROMPT = """\
You are a senior cotton procurement strategist and commodity analyst \
for spinning mills in South Asia (Bangladesh, India, Pakistan).

Your expertise:
- Cotton #2 ICE futures and global spot markets
- Supply/demand fundamentals: US, India, China, Brazil, West Africa
- Seasonal patterns: planting (Mar-May), growing (Jun-Sep), harvest (Oct-Dec) Northern Hemisphere
- South Asian demand: peak procurement Aug-Dec for winter/spring production runs
- Risk management: a mill running out of cotton is catastrophic — bias conservative

INSTRUCTIONS:
- Analyze the market data and news headlines holistically.
- Be specific and actionable — mills need exact tonnage guidance, not vague advice.
- Consider the client's timeline urgency vs current market conditions.
- When headlines are sparse or generic, weight statistical signals more heavily.

Return ONLY a JSON object with these fields:
{
  "signal": "STRONG_BUY" | "BUY" | "HOLD" | "AVOID",
  "confidence": <int 0-100>,
  "executive_summary": "<2-3 sentences for the MD/CEO>",
  "market_analysis": "<3-5 paragraph markdown analysis>",
  "monthly_plan": [
    {"month": 1, "pct": <percent of total>, "rationale": "<1 sentence>"},
    ...
  ],
  "risk_factors": ["<risk>", ...],
  "next_actions": ["<action>", ...],
  "key_levels": {"support": <float>, "resistance": <float>, "fair_value": <float>}
}
The monthly_plan pct values MUST sum to 100."""


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# DATA LAYER
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@st.cache_data(ttl=3600, show_spinner=False)
def fetch_cotton_prices(period: str = "5y") -> pd.DataFrame:
    """Fetch ICE Cotton #2 futures from Yahoo Finance."""
    ticker = yf.Ticker("CT=F")
    df = ticker.history(period=period)
    if df.empty:
        return pd.DataFrame()
    # yfinance returns ICE quote in US cents/lb → convert to $/lb
    if df["Close"].mean() > 5:
        df["Close"] = df["Close"] / 100.0
    return df


@st.cache_data(ttl=3600, show_spinner=False)
def load_csv_prices(raw_bytes: bytes) -> pd.DataFrame:
    """Parse a MacroTrends-style cotton CSV upload."""
    import io
    df = pd.read_csv(io.BytesIO(raw_bytes), skiprows=15, index_col="date", parse_dates=["date"])
    if " value" in df.columns:
        df = df.rename(columns={" value": "Close"})
    df["Close"] = pd.to_numeric(df["Close"], errors="coerce")
    return df[["Close"]].dropna()


def compute_benchmarks(df: pd.DataFrame) -> dict:
    """Compute statistical benchmarks from a price DataFrame with 'Close' column."""
    close = df["Close"].dropna()
    current = float(close.iloc[-1])
    date_str = close.index[-1].strftime("%Y-%m-%d")

    n = len(close)
    change_30d = ((current / close.iloc[-min(22, n)]) - 1) * 100 if n >= 2 else 0.0
    change_90d = ((current / close.iloc[-min(66, n)]) - 1) * 100 if n >= 2 else 0.0

    y1 = close.tail(min(252, n))
    y5 = close.tail(min(1260, n))

    rank_1y = float((y1 < current).mean())
    rank_5y = float((y5 < current).mean())

    mean_1y, std_1y = float(y1.mean()), float(y1.std())
    z_score = (current - mean_1y) / std_1y if std_1y > 0 else 0.0

    returns = close.pct_change().dropna()
    vol_30d = float(returns.tail(min(22, len(returns))).std() * np.sqrt(252) * 100) if len(returns) > 1 else 0.0
    vol_90d = float(returns.tail(min(66, len(returns))).std() * np.sqrt(252) * 100) if len(returns) > 1 else 0.0

    ma_50 = float(close.rolling(min(50, n)).mean().iloc[-1])
    ma_200 = float(close.rolling(min(200, n)).mean().iloc[-1])

    return {
        "current_price": round(current, 4),
        "price_date": date_str,
        "change_30d_pct": round(change_30d, 2),
        "change_90d_pct": round(change_90d, 2),
        "pct_rank_1y": round(rank_1y, 4),
        "pct_rank_5y": round(rank_5y, 4),
        "z_score_1y": round(z_score, 2),
        "vol_30d_ann": round(vol_30d, 1),
        "vol_90d_ann": round(vol_90d, 1),
        "ma_50d": round(ma_50, 4),
        "ma_200d": round(ma_200, 4),
        "above_ma_50d": current > ma_50,
        "above_ma_200d": current > ma_200,
        "high_1y": round(float(y1.max()), 4),
        "low_1y": round(float(y1.min()), 4),
    }


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# NEWS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@st.cache_data(ttl=1800, show_spinner=False)
def fetch_headlines() -> list[dict]:
    """Fetch recent headlines from configured RSS feeds."""
    items: list[dict] = []
    for url in RSS_FEEDS:
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:12]:
                summary = re.sub(r"<[^>]+>", "", entry.get("summary", "") or "")[:300]
                items.append({
                    "title": entry.get("title", "").strip(),
                    "summary": summary.strip(),
                    "link": entry.get("link", ""),
                    "published": entry.get("published", ""),
                })
        except Exception:
            continue
    return items[:40]


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# AI INTELLIGENCE
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _get_api_key() -> str | None:
    try:
        return st.secrets["OPENAI_API_KEY"]
    except Exception:
        return os.getenv("OPENAI_API_KEY")


@st.cache_data(ttl=1800, show_spinner=False)
def ai_strategy(
    benchmarks_json: str,
    headlines_json: str,
    company: str,
    tonnage: float,
    months: int,
    api_key: str,
) -> dict:
    """Call OpenAI to generate a full procurement strategy."""
    user_msg = f"""CURRENT MARKET DATA (Cotton #2 Futures):
{benchmarks_json}

RECENT NEWS HEADLINES:
{headlines_json}

CLIENT REQUIREMENT:
- Company: {company}
- Total tonnage: {tonnage:,.0f} tonnes
- Horizon: {months} months
- Implied monthly rate: {tonnage / months:,.0f} tonnes/month

Analyze the market and generate a procurement strategy for this client."""

    payload = {
        "model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        "temperature": 0.3,
        "response_format": {"type": "json_object"},
    }

    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = json.loads(resp.read())
    text = data["choices"][0]["message"]["content"].strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", text)
        if m:
            return json.loads(m.group(0))
        return {"signal": "HOLD", "error": "Could not parse AI response"}


def heuristic_strategy(benchmarks: dict, tonnage: float, months: int) -> dict:
    """Deterministic fallback when no API key is available."""
    rank = benchmarks["pct_rank_1y"]
    z = benchmarks["z_score_1y"]
    vol = benchmarks["vol_30d_ann"]

    if rank < 0.15 and z < -1:
        signal, confidence = "STRONG_BUY", 80
    elif rank < 0.30:
        signal, confidence = "BUY", 65
    elif rank > 0.80:
        signal, confidence = "AVOID", 70
    else:
        signal, confidence = "HOLD", 50

    n = months
    base = np.ones(n)
    if signal in ("STRONG_BUY", "BUY"):
        base = base * np.exp(-0.3 * np.arange(n))
    elif signal == "AVOID":
        base = base * np.exp(0.3 * np.arange(n))
    if vol > 30:
        base = 0.7 * base + 0.3 * np.ones(n)
    weights = base / base.sum()

    plan = []
    for i in range(n):
        pct = float(weights[i] * 100)
        plan.append({
            "month": i + 1,
            "pct": round(pct, 1),
            "tonnes": round(tonnage * weights[i], 1),
            "rationale": {
                "STRONG_BUY": "Front-loaded — price is historically cheap",
                "BUY": "Moderately front-loaded — attractive entry",
                "AVOID": "Back-loaded — price is expensive, defer",
                "HOLD": "Uniform — no strong directional signal",
            }.get(signal, "Uniform"),
        })

    above_50 = "above" if benchmarks["above_ma_50d"] else "below"
    above_200 = "above" if benchmarks["above_ma_200d"] else "below"
    px = benchmarks["current_price"]

    signal_text = {
        "STRONG_BUY": f"Price at ${px:.4f}/lb is historically cheap ({rank:.0%} of 1Y range). Prioritise building inventory.",
        "BUY": f"Price at ${px:.4f}/lb is moderately attractive ({rank:.0%} of 1Y range). Increase procurement pacing.",
        "AVOID": f"Price at ${px:.4f}/lb is elevated ({rank:.0%} of 1Y range). Minimise new exposure and defer weight.",
        "HOLD": f"Price at ${px:.4f}/lb is mid-range ({rank:.0%} of 1Y range). Maintain baseline procurement cadence.",
    }

    return {
        "signal": signal,
        "confidence": confidence,
        "executive_summary": signal_text.get(signal, ""),
        "market_analysis": (
            f"**Price context**: ${px:.4f}/lb sits at the {rank:.0%} percentile of its "
            f"1-year range (${benchmarks['low_1y']:.4f} – ${benchmarks['high_1y']:.4f}). "
            f"Z-score: {z:.2f}. Currently {above_50} 50d MA (${benchmarks['ma_50d']:.4f}) "
            f"and {above_200} 200d MA (${benchmarks['ma_200d']:.4f}).\n\n"
            f"**Momentum**: 30-day change {benchmarks['change_30d_pct']:+.1f}%, "
            f"90-day change {benchmarks['change_90d_pct']:+.1f}%.\n\n"
            f"**Volatility**: {vol:.1f}% annualized (30d). "
            f"{'Elevated — spread purchases to reduce execution risk.' if vol > 30 else 'Normal regime.'}\n\n"
            f"*This is a statistical heuristic. Connect OpenAI for full AI analysis including "
            f"news interpretation, seasonal reasoning, and strategic depth.*"
        ),
        "monthly_plan": plan,
        "risk_factors": [
            "Statistical heuristic only — no news or fundamental analysis.",
            *(["Elevated volatility increases execution risk on large orders."] if vol > 30 else []),
            *(["Price is near 1Y highs — basis risk is elevated."] if rank > 0.8 else []),
        ],
        "next_actions": [
            "Connect OpenAI API key for AI-powered analysis.",
            "Verify quality/count mix and wastage assumptions.",
            "Align roadmap with credit limits and warehouse capacity.",
        ],
    }


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# UI
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SIGNAL_COLORS = {
    "STRONG_BUY": "#00c853",
    "BUY": "#2979ff",
    "HOLD": "#ff9100",
    "AVOID": "#ff1744",
}


def render_price_chart(df: pd.DataFrame, benchmarks: dict) -> None:
    close = df["Close"]
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=close.index, y=close, name="Cotton #2",
        line=dict(color="#2979ff", width=2),
    ))
    fig.add_trace(go.Scatter(
        x=close.index, y=close.rolling(50).mean(), name="50d MA",
        line=dict(color="#ff9100", width=1, dash="dash"),
    ))
    fig.add_trace(go.Scatter(
        x=close.index, y=close.rolling(200).mean(), name="200d MA",
        line=dict(color="#ff1744", width=1, dash="dot"),
    ))
    fig.add_hline(
        y=benchmarks["current_price"], line_dash="solid",
        line_color="white", opacity=0.3,
        annotation_text=f"Current: ${benchmarks['current_price']:.4f}",
    )
    fig.update_layout(
        yaxis_title="$/lb", xaxis_title="",
        height=420, template="plotly_dark",
        margin=dict(l=0, r=0, t=30, b=0),
        legend=dict(orientation="h", yanchor="bottom", y=1.02),
    )
    st.plotly_chart(fig, use_container_width=True)


def render_roadmap(strategy: dict, tonnage: float) -> None:
    plan = strategy.get("monthly_plan", [])
    if not plan:
        return

    total_pct = sum(p.get("pct", 0) for p in plan)
    if total_pct > 0:
        for p in plan:
            p["pct"] = p["pct"] / total_pct * 100
            p["tonnes"] = round(tonnage * p["pct"] / 100, 1)
            p["pct"] = round(p["pct"], 1)

    col_a, col_b = st.columns([1, 1])
    with col_a:
        display_df = pd.DataFrame(plan)[["month", "tonnes", "pct", "rationale"]]
        display_df.columns = ["Month", "Tonnes", "% of Total", "Rationale"]
        st.dataframe(display_df, use_container_width=True, hide_index=True)
    with col_b:
        fig = go.Figure(data=go.Bar(
            x=[f"M{p['month']}" for p in plan],
            y=[p["tonnes"] for p in plan],
            marker_color="#2979ff",
            text=[f"{p['tonnes']:,.0f}t" for p in plan],
            textposition="auto",
        ))
        fig.update_layout(
            yaxis_title="Tonnes", height=320,
            template="plotly_dark",
            margin=dict(l=0, r=0, t=10, b=0),
        )
        st.plotly_chart(fig, use_container_width=True)


def main() -> None:
    st.set_page_config(
        page_title="Cotton Market Intelligence",
        page_icon="🏭",
        layout="wide",
        initial_sidebar_state="expanded",
    )

    st.title("Cotton Market Intelligence")
    st.caption("AI-native procurement advisor for spinning mills")

    # ── Sidebar ──
    with st.sidebar:
        st.header("Procurement brief")
        company = st.text_input("Company name", "ACME Spinning Ltd")
        tonnage = st.number_input("Tonnes needed", min_value=100, value=5000, step=500)
        months = st.slider("Horizon (months)", 1, 12, 6)

        st.divider()
        st.subheader("Data source")
        source = st.radio(
            "Cotton prices",
            ["Live futures (Yahoo Finance)", "Upload CSV (MacroTrends)"],
            index=0,
        )
        uploaded_file = None
        if source == "Upload CSV (MacroTrends)":
            uploaded_file = st.file_uploader("Cotton daily CSV", type="csv")

        st.divider()
        api_key = _get_api_key()
        if api_key:
            st.success("OpenAI connected", icon="✅")
        else:
            st.info("Add OPENAI_API_KEY for full AI analysis", icon="🔑")

        generate = st.button("Generate Strategy", type="primary", use_container_width=True)

    # ── Data fetch ──
    prices = pd.DataFrame()
    if uploaded_file is not None:
        with st.spinner("Parsing CSV..."):
            prices = load_csv_prices(uploaded_file.getvalue())
    else:
        with st.spinner("Fetching live cotton futures..."):
            prices = fetch_cotton_prices()

    if prices.empty:
        st.error(
            "Could not load cotton price data. If using live futures, markets may be "
            "closed or Yahoo Finance may be temporarily unavailable. Try uploading a CSV instead."
        )
        st.stop()

    bm = compute_benchmarks(prices)

    # ── Metrics row ──
    m1, m2, m3, m4, m5 = st.columns(5)
    with m1:
        st.metric("Cotton #2", f"${bm['current_price']:.4f}/lb",
                   delta=f"{bm['change_30d_pct']:+.1f}% (30d)")
    with m2:
        rank_label = "Cheap" if bm["pct_rank_1y"] < 0.3 else ("Expensive" if bm["pct_rank_1y"] > 0.7 else "Mid-range")
        st.metric("1Y Percentile", f"{bm['pct_rank_1y']:.0%}", delta=rank_label,
                   delta_color="inverse")
    with m3:
        st.metric("Z-Score (1Y)", f"{bm['z_score_1y']:.2f}")
    with m4:
        st.metric("Volatility (30d)", f"{bm['vol_30d_ann']:.1f}%")
    with m5:
        ma_status = "Above" if bm["above_ma_200d"] else "Below"
        st.metric("200d MA", f"${bm['ma_200d']:.4f}", delta=f"{ma_status}")

    # ── Price chart ──
    render_price_chart(prices, bm)

    # ── Strategy generation ──
    if generate:
        headlines = fetch_headlines()
        headline_titles = [{"title": h["title"], "summary": h["summary"][:150]} for h in headlines[:25]]

        with st.spinner("AI is analyzing market conditions..." if api_key else "Computing strategy..."):
            if api_key:
                strategy = ai_strategy(
                    json.dumps(bm, indent=2),
                    json.dumps(headline_titles, indent=2),
                    company, tonnage, months, api_key,
                )
            else:
                strategy = heuristic_strategy(bm, tonnage, months)

        st.session_state["strategy"] = strategy
        st.session_state["headlines"] = headlines

    strategy = st.session_state.get("strategy")
    if strategy is None:
        st.info("Enter your procurement brief in the sidebar and click **Generate Strategy**.")
        st.stop()

    headlines = st.session_state.get("headlines", [])

    # ── Signal badge ──
    signal = strategy.get("signal", "HOLD")
    color = SIGNAL_COLORS.get(signal, "#999")
    confidence = strategy.get("confidence", "?")
    st.markdown(
        f'<div style="background:{color}22; border-left:4px solid {color}; '
        f'padding:16px 20px; border-radius:8px; margin:12px 0;">'
        f'<span style="font-size:1.4em; font-weight:700; color:{color};">{signal}</span>'
        f'<span style="margin-left:16px; opacity:0.8;">confidence {confidence}%</span>'
        f'<div style="margin-top:8px; font-size:1.05em;">'
        f'{strategy.get("executive_summary", "")}</div></div>',
        unsafe_allow_html=True,
    )

    # ── Market analysis ──
    with st.expander("Full Market Analysis", expanded=True):
        st.markdown(strategy.get("market_analysis", ""))

    # ── Key levels ──
    levels = strategy.get("key_levels")
    if levels and isinstance(levels, dict):
        lc1, lc2, lc3 = st.columns(3)
        with lc1:
            st.metric("Support", f"${levels.get('support', 0):.4f}/lb")
        with lc2:
            st.metric("Fair Value", f"${levels.get('fair_value', levels.get('fair_value_estimate', 0)):.4f}/lb")
        with lc3:
            st.metric("Resistance", f"${levels.get('resistance', 0):.4f}/lb")

    # ── Procurement roadmap ──
    st.subheader(f"Procurement Roadmap — {tonnage:,.0f}t over {months} months")
    render_roadmap(strategy, tonnage)

    # ── Risk factors ──
    risks = strategy.get("risk_factors", [])
    if risks:
        st.subheader("Risk Factors")
        for r in risks:
            if r:
                st.markdown(f"- {r}")

    # ── Next actions ──
    actions = strategy.get("next_actions", [])
    if actions:
        st.subheader("Next Actions")
        for a in actions:
            if a:
                st.markdown(f"- {a}")

    # ── Headlines used ──
    if headlines:
        with st.expander(f"News Headlines Analyzed ({len(headlines)})"):
            for h in headlines[:20]:
                link = h.get("link", "#")
                st.markdown(f"- [{h['title']}]({link})")

    # ── Download ──
    st.divider()
    st.download_button(
        "Download Strategy (JSON)",
        json.dumps(strategy, indent=2, default=str),
        file_name=f"procurement_strategy_{datetime.now().strftime('%Y%m%d')}.json",
        mime="application/json",
    )

    st.caption(
        f"Data as of {bm['price_date']} · "
        f"{'AI-powered (OpenAI)' if api_key else 'Statistical heuristic'} · "
        f"Cotton Market Intelligence v2"
    )


if __name__ == "__main__":
    main()
