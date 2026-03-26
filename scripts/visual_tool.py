#!/usr/bin/env python3
"""
Cotton Market Intelligence – Visual Dashboard

Renders price history, benchmark bands, and current buy signal.
Run from repo root: python -m scripts.visual_tool
"""
from __future__ import annotations

import os
from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.dates as mdates

from dotenv import load_dotenv

from src.cotton_prices import PriceLoadConfig, load_cotton_prices
from src.benchmarks import BenchmarksConfig, compute_price_benchmarks, evaluate_spot_snapshot
from src.config_loader import load_mill_profiles, load_signal_config
from src.buy_rules import generate_signal_for_date


def _resolve_data_path() -> Path:
    load_dotenv()
    path = os.getenv("COTTON_DAILY_DATA_LOCAL_FILEPATH")
    if path:
        return Path(path)
    # Fallback
    return Path("data") / "cotton_macrotrends_daily.csv"


def _signal_color(signal: str) -> str:
    return {"STRONG_BUY": "#22c55e", "BUY": "#84cc16", "HOLD": "#eab308", "AVOID": "#ef4444"}.get(
        signal, "#64748b"
    )


def run_visual(output_path: str | Path | None = None, show: bool = True) -> None:
    project_root = Path(__file__).resolve().parent.parent
    os.chdir(project_root)

    csv_path = _resolve_data_path()
    if not csv_path.exists():
        raise FileNotFoundError(
            f"Cotton data not found at {csv_path}. "
            "Set COTTON_DAILY_DATA_LOCAL_FILEPATH in .env or place data at data/cotton_macrotrends_daily.csv"
        )

    wb_path = project_root / "data" / "WBCOMM_Prices.xlsx"
    wb_str = str(wb_path) if wb_path.exists() else None

    price_cfg = PriceLoadConfig(
        macrotrends_csv_path=str(csv_path),
        worldbank_xlsx_path=wb_str,
        fred_codes={"CPI": "CPIAUCSL"},
    )
    prices = load_cotton_prices(price_cfg)

    bm_cfg = BenchmarksConfig()
    prices_bm = compute_price_benchmarks(prices, config=bm_cfg)

    profiles = load_mill_profiles(project_root / "config" / "mill_profiles.yml")
    mill = profiles.get("BD_Mill_25kSpindles_30Ne") or next(iter(profiles.values()))
    signal_cfg = load_signal_config(project_root / "config" / "signals.yml")
    decision = generate_signal_for_date(prices_bm, profile=mill, config=signal_cfg)
    snapshot = evaluate_spot_snapshot(prices_bm)

    # Plot
    fig, axes = plt.subplots(2, 1, figsize=(12, 8), height_ratios=[2, 1], sharex=True)
    ax1, ax2 = axes

    price = prices_bm["cotton_spot_usd_per_lb"]
    ax1.plot(price.index, price.values, color="#0f172a", linewidth=1.2, label="Spot ($/lb)")

    if "pct_252d_p25" in prices_bm.columns:
        ax1.fill_between(
            prices_bm.index,
            prices_bm["pct_252d_p25"],
            prices_bm["pct_252d_p75"],
            alpha=0.2,
            color="#3b82f6",
            label="1Y p25–p75 band",
        )
        ax1.plot(
            prices_bm.index,
            prices_bm["pct_252d"],
            color="#3b82f6",
            linestyle="--",
            alpha=0.7,
            linewidth=0.8,
            label="1Y median",
        )

    ax1.axhline(
        snapshot.get("current_price", price.iloc[-1]),
        color=_signal_color(decision.signal),
        linestyle=":",
        alpha=0.8,
        linewidth=1,
    )
    ax1.set_ylabel("Price ($/lb)")
    ax1.set_title("Cotton Spot Price & Benchmarks")
    ax1.legend(loc="upper right", fontsize=8)
    ax1.grid(True, alpha=0.3)
    ax1.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))

    # Signal badge
    ax1.text(
        0.02,
        0.98,
        f"Signal: {decision.signal}",
        transform=ax1.transAxes,
        fontsize=14,
        fontweight="bold",
        verticalalignment="top",
        bbox=dict(boxstyle="round", facecolor=_signal_color(decision.signal), alpha=0.3),
    )
    ax1.text(
        0.02,
        0.88,
        f"Suggested: {decision.suggested_qty_tons:.1f} tons",
        transform=ax1.transAxes,
        fontsize=10,
        verticalalignment="top",
    )

    # Volatility subplot
    if "vol_30d" in prices_bm.columns:
        vol = prices_bm["vol_30d"].dropna()
        if not vol.empty:
            ax2.fill_between(vol.index, 0, vol.values, alpha=0.4, color="#6366f1")
            ax2.set_ylabel("30d vol (log ret)")
    ax2.set_xlabel("Date")
    ax2.grid(True, alpha=0.3)
    ax2.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))

    plt.tight_layout()

    if output_path:
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(output_path, dpi=150, bbox_inches="tight")
        print(f"Saved: {output_path}")

    if show:
        plt.show()
    else:
        plt.close()


if __name__ == "__main__":
    run_visual(output_path="output/cotton_dashboard.png", show=True)
