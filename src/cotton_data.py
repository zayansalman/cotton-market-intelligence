from __future__ import annotations

from typing import Dict

import numpy as np
import pandas as pd
import pandas_datareader.data as pdr


def load_macrotrends_daily(
    csv_path: str,
    start_date: str = "2000-01-01",
    price_column: str = "cotton_spot_usd_per_lb",
) -> pd.DataFrame:
    """
    Load the daily cotton price series from a MacroTrends CSV export.

    Expected CSV characteristics:
    - A 'date' column that should become the index
    - A price column named ' value' containing the daily cotton price in $/lb
      (MacroTrends default), which we rename to `price_column`.
    - A metadata header of 15 rows that should be skipped.
    """
    df = (
        pd.read_csv(
            csv_path,
            skiprows=15,
            index_col="date",
            parse_dates=["date"],
        ).rename(columns={" value": price_column})
    )

    df[price_column] = pd.to_numeric(df[price_column])
    df = df[[price_column]].loc[start_date:].dropna()
    return df


def load_worldbank_monthly(
    filepath: str,
    cotton_column_contains: str = "Cotton, A Index",
) -> pd.DataFrame:
    """
    Load the World Bank monthly commodities workbook into a tidy DataFrame.

    This mirrors the header/row cleaning logic currently used in the notebooks and
    returns a DataFrame indexed by a monthly PeriodIndex with numeric columns.
    """
    wb_df = pd.read_excel(filepath, sheet_name=1, skiprows=4)

    new_header = wb_df.columns + wb_df.iloc[0]
    wb_df.columns = new_header
    wb_df = wb_df.drop(0)

    # First column is the YearMonth string such as 1960M01.
    wb_df = wb_df.rename(columns={wb_df.columns[0]: "YearMonth"})
    wb_df["YearMonth"] = pd.to_datetime(wb_df["YearMonth"], format="%YM%m")
    wb_df.set_index("YearMonth", inplace=True)

    wb_df = wb_df.apply(pd.to_numeric, errors="coerce")

    # Standardize at least the main Cotton A Index column name if present.
    cotton_cols = [c for c in wb_df.columns if cotton_column_contains in str(c)]
    if cotton_cols:
        main = cotton_cols[0]
        wb_df = wb_df.rename(columns={main: "cotton_a_index_usd_per_kg"})

    return wb_df


def get_fred_series(
    start_date: str,
    end_date: str,
    fred_codes_dict: Dict[str, str],
) -> pd.DataFrame:
    """
    Fetch data from the Federal Reserve Economic Data (FRED) service.

    Args:
        start_date: Start date in 'YYYY-MM-DD' format.
        end_date: End date in 'YYYY-MM-DD' format.
        fred_codes_dict: Mapping from desired column names to FRED series codes.

    Returns:
        DataFrame with DateTimeIndex and one column per key in fred_codes_dict.
    """
    if not isinstance(fred_codes_dict, dict):
        raise ValueError("fred_codes_dict must be a dictionary")

    codes_df_list = []
    for name, code in fred_codes_dict.items():
        data = pdr.get_data_fred(code, start=start_date, end=end_date)
        data = data.rename(columns={code: name})
        codes_df_list.append(data)

    if not codes_df_list:
        return pd.DataFrame()

    df = pd.concat(codes_df_list, axis=1, ignore_index=False)
    return df


def compute_price_benchmarks(
    series: pd.Series,
    horizon_years: int = 5,
) -> Dict[str, float]:
    """
    Compute simple statistical benchmarks for the most recent price.
    """
    if series.empty:
        raise ValueError("Series is empty")

    end = series.index[-1]
    start_cutoff = end - pd.DateOffset(years=horizon_years)
    window = series.loc[start_cutoff:end].dropna()

    current_price = float(series.iloc[-1])
    mean = float(window.mean())
    std = float(window.std(ddof=0))
    z_score = float((current_price - mean) / std) if std > 0 else float("nan")

    p25, p50, p75 = np.percentile(window.values, [25, 50, 75])

    return {
        "current_price": current_price,
        "horizon_years": float(horizon_years),
        "mean": mean,
        "std": std,
        "z_score": z_score,
        "p25": float(p25),
        "p50": float(p50),
        "p75": float(p75),
    }


def compute_real_price(
    nominal_series: pd.Series,
    cpi_series: pd.Series,
) -> pd.Series:
    """
    Adjust a nominal cotton price series using a CPI-based deflator.
    """
    if nominal_series.empty or cpi_series.empty:
        raise ValueError("Series must not be empty")

    cpi = cpi_series.reindex(nominal_series.index).ffill().bfill()
    base_cpi = cpi.iloc[-1]

    real_price = nominal_series * (base_cpi / cpi)
    real_price.name = f"{nominal_series.name}_real"
    return real_price


def compute_rolling_vol(
    series: pd.Series,
    window_days: int = 60,
) -> pd.Series:
    """
    Compute simple rolling volatility (standard deviation of log returns).
    """
    if series.empty:
        raise ValueError("Series is empty")

    log_returns = np.log(series / series.shift(1)).dropna()
    vol = log_returns.rolling(window_days).std()
    vol.name = f"{series.name}_rolling_vol_{window_days}d"
    return vol

