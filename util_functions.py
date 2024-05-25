import numpy as np
import pandas as pd
from scipy import stats


def find_cols(df, word):
    """
    Find columns in a DataFrame that contain a specific word.

    Parameters:
        df (DataFrame): The DataFrame to search.
        word (str): The word to search for in column names.

    Returns:
        list: A list of column names containing the specified word.
    """
    return [col for col in df.columns if word in col]


def remove_outliers(df):
    """
    Remove outliers from a DataFrame based on Z-scores.

    This function calculates the Z-scores for each element in the DataFrame.
    Elements with a Z-score greater than the threshold are considered outliers
    and are removed.

    Args:
        df (pd.DataFrame): The input DataFrame from which outliers are to be removed.

    Returns:
        pd.DataFrame: A DataFrame with outliers removed.
    
    """
    # Calculate the Z-scores of the DataFrame
    z_scores = np.abs(stats.zscore(df))
    
    # Define the threshold for identifying outliers
    threshold = 3
    
    # Retain rows where all values have Z-scores below the threshold
    return df[(z_scores < threshold)]


def get_outliers(df):
    """
    Identify outliers in a DataFrame based on Z-scores.

    This function calculates the Z-scores for each element in the DataFrame.
    Elements with a Z-score greater than the threshold are considered outliers
    and are returned.

    Args:
        df (pd.DataFrame): The input DataFrame from which outliers are to be identified.

    Returns:
        pd.DataFrame: A DataFrame containing only the rows where any value has
        a Z-score greater than the threshold.
    
    """
    # Calculate the Z-scores of the DataFrame
    z_scores = np.abs(stats.zscore(df))
    
    # Define the threshold for identifying outliers
    threshold = 3
    
    # Retain rows where any value has a Z-score above the threshold
    return df[(z_scores > threshold)]