from __future__ import annotations

from dataclasses import dataclass
from typing import Dict

import pandas as pd

from ..cotton_data import (
    load_macrotrends_daily,
    load_worldbank_monthly,
    get_fred_series,
    compute_real_price,
)


@dataclass
class PriceLoadConfig:
    """
    Configuration for loading and aligning core cotton price and macro series.
    """

    macrotrends_csv_path: str
    worldbank_xlsx_path: str | None = None
    start_date: str = "2000-01-01"
    end_date: str | None = None
    fred_codes: Dict[str, str] | None = None  # e.g. {"CPI": "CPIAUCSL"}


def load_cotton_prices(config: PriceLoadConfig) -> pd.DataFrame:
    """
    Load and align core cotton price and inflation series into a single daily frame.

    Columns (when data is available):
    - cotton_spot_usd_per_lb
    - cotton_a_index_usd_per_kg (monthly, forward-filled to daily)
    - CPI (if fred_codes provided)
    - cotton_spot_real (CPI-adjusted spot price, indexed to latest CPI)
    """
    spot_df = load_macrotrends_daily(
        csv_path=config.macrotrends_csv_path,
        start_date=config.start_date,
        price_column="cotton_spot_usd_per_lb",
    )

    df = spot_df.copy()

    # Optional World Bank monthly Cotton A Index
    if config.worldbank_xlsx_path is not None:
        wb_df = load_worldbank_monthly(config.worldbank_xlsx_path)
        cotton_a = wb_df[["cotton_a_index_usd_per_kg"]].dropna()
        # Convert monthly to daily by forward-fill on a daily index.
        cotton_a_daily = (
            cotton_a.resample("D")
            .ffill()
            .rename(columns={"cotton_a_index_usd_per_kg": "cotton_a_index_usd_per_kg"})
        )
        df = df.join(cotton_a_daily, how="left")

    # Optional FRED series such as CPI
    if config.fred_codes:
        end_date = (
            config.end_date
            if config.end_date is not None
            else df.index.max().strftime("%Y-%m-%d")
        )
        start_date = df.index.min().strftime("%Y-%m-%d")
        fred_df = get_fred_series(
            start_date=start_date,
            end_date=end_date,
            fred_codes_dict=config.fred_codes,
        )
        fred_df = fred_df.reindex(df.index).ffill().bfill()
        df = df.join(fred_df, how="left")

        # If a CPI-like column is present, compute a real price series.
        cpi_col = next((c for c in df.columns if "CPI" in str(c)), None)
        if cpi_col is not None:
            real_series = compute_real_price(
                nominal_series=df["cotton_spot_usd_per_lb"],
                cpi_series=df[cpi_col],
            )
            df["cotton_spot_real"] = real_series

    if config.end_date is not None:
        df = df.loc[: config.end_date]

    return df


def add_inflation_series(
    prices_df: pd.DataFrame,
    cpi_series: pd.Series,
    column_name: str = "cotton_spot_real",
) -> pd.DataFrame:
    """
    Convenience wrapper to compute an inflation-adjusted cotton spot series
    when CPI has been loaded separately.
    """
    if "cotton_spot_usd_per_lb" not in prices_df.columns:
        raise ValueError("Expected 'cotton_spot_usd_per_lb' in prices_df.")

    real_series = compute_real_price(
        nominal_series=prices_df["cotton_spot_usd_per_lb"],
        cpi_series=cpi_series,
    )
    df = prices_df.copy()
    df[column_name] = real_series
    return df

