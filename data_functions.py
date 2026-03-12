import pandas as pd
import pandas_datareader.data as pdr


def get_fred_data(start_date, end_date, fred_codes_dict={"CPI": "CPIAUCSL"}):
    """
    Fetch data from the Federal Reserve Economic Data (FRED) service for specified codes.

    This function retrieves data from FRED for the given codes within the specified date range
    and returns a DataFrame containing the data.

    Args:
        start_date (str): The start date for the data in 'YYYY-MM-DD' format.
        end_date (str): The end date for the data in 'YYYY-MM-DD' format.
        fred_codes_dict (dict): A dictionary where keys are the desired column names
                                and values are the corresponding FRED series codes.

    Returns:
        pd.DataFrame: A DataFrame containing the FRED data for the specified codes and date range.

    Raises:
        ValueError: If fred_codes_dict is not a dictionary.
    """
    if not isinstance(fred_codes_dict, dict):
        raise ValueError("fred_codes_dict must be a dictionary")

    codes_df_list = []
    codes_df = pd.DataFrame()

    for name, code in fred_codes_dict.items():
        data = pdr.get_data_fred(code, start=start_date, end=end_date)
        data[name] = data[code]
        codes_df_list.append(data)

    codes_df = pd.concat(codes_df_list, axis=1, ignore_index=False).drop(
        columns=list(fred_codes_dict.values())
    )

    return codes_df


def load_cotton_daily_series(csv_path, start_date="2000-01-01", price_col_name="$/lbs"):
    """
    Load the daily cotton price series from the MacroTrends CSV export.

    The file is expected to:
    - Have a 'date' column that should become the index
    - Store prices in a column named ' value' that we rename to price_col_name
    - Contain a metadata header that should be skipped
    """
    cotton_df = (
        pd.read_csv(
            csv_path,
            skiprows=15,
            index_col="date",
            parse_dates=["date"],
        ).rename(columns={" value": price_col_name})
    )

    cotton_df[price_col_name] = pd.to_numeric(cotton_df[price_col_name])
    cotton_df = cotton_df[[price_col_name]].loc[start_date:].dropna()
    return cotton_df


def load_wb_commodities(filepath):
    """
    Load the World Bank monthly commodities workbook into a tidy DataFrame.

    This applies the same header/row cleaning logic used in the notebooks so that
    analysis code can operate on a consistently shaped DataFrame.
    """
    wb_commodities_df = pd.read_excel(filepath, sheet_name=1, skiprows=4)

    new_header = wb_commodities_df.columns + wb_commodities_df.iloc[0]
    wb_commodities_df.columns = new_header
    wb_commodities_df = wb_commodities_df.drop(0)

    return wb_commodities_df
