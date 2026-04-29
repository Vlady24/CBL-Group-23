import pandas as pd
import glob
import os


# cleans the concatenated datasets by the following logic:
# 1. in some datasets the context column is completely empty so i believe we don't need it
# 2. remove double entries
# 3. drop rows without LSOA code since without an LSOA the row info is useless (correct me if i'm wrong :) )


# also it prints the datasets completely deleted (if there are any) for the reason of double checking the old dataset

# check police_data_cleaned

input_dir = './police_data_by_force/'
output_dir = './police_data_cleaned/'

# creating new output directory
os.makedirs(output_dir, exist_ok=True)

all_force_files = glob.glob(f"{input_dir}/*.csv")

# list used to flag completely deleted datasets to double check later
completely_deleted = list()

for file_path in all_force_files:
    filename = os.path.basename(file_path)
    print(f"Cleaning {filename}")
    
    df = pd.read_csv(file_path)
    orig_len = len(df)
    
    # droping 'Context' column if it exists and is completely empty
    if 'Context' in df.columns and df['Context'].isnull().all():
        df_clean = df.drop(columns=['Context'])
    else:
        df_clean = df.copy()
    
    # remove accidental double-entries
    df_clean = df_clean.drop_duplicates()
    
    # drop rows without an LSOA code
    if 'LSOA code' in df_clean.columns:
        df_clean = df_clean.dropna(subset=['LSOA code'])
        
    clean_len = len(df_clean)
    
    if clean_len == 0:
        completely_deleted.append(filename)

    output_path = os.path.join(output_dir, filename)
    df_clean.to_csv(output_path, index=False)
    
    print(f"  -> Dropped {orig_len - clean_len} rows. Saved {clean_len} rows.")

print(completely_deleted)