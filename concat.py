import pandas as pd
import glob
import os

# concatenates each monthly dataset into one csv file for each police force
# check police_data_by_force

# folder setup
base_path = './2026-02/' 
output_dir = './police_data_by_force/' 
os.makedirs(output_dir, exist_ok=True)

# get only street.csv for each police force
all_street_files = glob.glob(f"{base_path}/*/*-street.csv")
all_street_files.sort() # chronological sorting

police_forces = []
for file in all_street_files:
    filename = os.path.basename(file)
    force_name = filename[8:].replace('-street.csv', '')
    
    if force_name not in police_forces:
        police_forces.append(force_name)

print(f"Found {len(police_forces)} unique forces")

# concatenating
for force in police_forces:

    files_for_this_force = [f for f in all_street_files if force in f]
    combined_data = pd.concat([pd.read_csv(f) for f in files_for_this_force], ignore_index=True)

    combined_data.to_csv(f"{output_dir}/{force}_all_months.csv", index=False)