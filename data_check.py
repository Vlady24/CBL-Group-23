import pandas as pd

# this is done only on 1 dataset just for testing
# you can discard it
# cleaning_pipeline.py is the important one


file_path = './police_data_by_force/city-of-london_all_months.csv'
df = pd.read_csv(file_path)

print(f"Checking: {file_path}")
print(f"Total rows: {len(df)}\n")

# check for missing values (only print columns that actually have NaNs)
missing = df.isnull().sum()
print("Missing data per column:")
print(missing[missing > 0], "\n")

# check for accidental double entries
print(f"Exact duplicates found: {df.duplicated().sum()}\n")

# check if we're missing location data
if 'LSOA code' in df.columns:
    missing_lsoa = df['LSOA code'].isnull().sum()
    print(f"Missing LSOA codes: {missing_lsoa}\n")
    
# check what crime categories exist in this specific force
if 'Crime type' in df.columns:
    print("Unique crime categories:")
    print(df['Crime type'].unique())