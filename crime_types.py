import pandas as pd
import os
import glob


input_path = './police_data_cleaned'

force_files = glob.glob(f'{input_path}/*.csv')

unique_crimes = set()

for file in force_files:
    try:
        df = pd.read_csv(file, usecols=['Crime type'])

        unique_crimes.update(df['Crime type'].dropna().unique())

    except Exception as e:
        print(f'Error in reading file {file}: {e}')

sorted_crimes = sorted(unique_crimes)

print(sorted_crimes)
print(f"Total number of unique crimes is: {len(sorted_crimes)}")