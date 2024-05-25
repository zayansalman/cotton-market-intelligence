import pandas as pd
import pandas_datareader.data as pdr

def get_fred_data(start_date, end_date, fred_codes_dict={'CPI': 'CPIAUCSL'}):
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

    # Loop through each code in the dictionary
    for name, code in fred_codes_dict.items():
        # Fetch data from FRED for the given code and date range
        data = pdr.get_data_fred(code, start=start_date, end=end_date)
        
        # Rename the column to the user-specified name
        data[name] = data[code]
        
        # Append the data to the list
        codes_df_list.append(data)
    
    # Concatenate all dataframes in the list along the columns
    codes_df = pd.concat(codes_df_list, axis=1, ignore_index=False).drop(columns=list(fred_codes_dict.values()))

    return codes_df
