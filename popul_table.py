import pandas as pd
import sqlite3
from pathlib import Path

# add 'population' table to the database to allow normalization of crime counts by population size

df = pd.read_excel("population.xlsx", sheet_name = "Mid-2023 LSOA 2021", skiprows = 3)

print(df.columns)

df = df[["LSOA 2021 Code", "Total"]]
df.columns = ["lsoa_code", "population"]
df = df.dropna()
df["lsoa_code"] = df["lsoa_code"].str.strip()

conn = sqlite3.connect("CBL-Group-23/crime_data.db")

df.to_sql("population", conn, if_exists="replace", index=False)

conn.commit()
conn.close()