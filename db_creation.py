import pandas as pd
import sqlite3
from pathlib import Path

main = Path(r"all_data")
all_files = list(main.rglob("*.csv"))

conn = sqlite3.connect("crime_data.sqlite")

record_id = 1
first_file = True
total_rows = 0

# go though all files in folder (stored locally), perform minor data cleaning

for f in all_files:
    df = pd.read_csv(f)
    df.columns = (df.columns.str.strip().str.lower().str.replace(" ", "_"))

    df = df.replace("", pd.NA)

    df["longitude"] = df["longitude"].astype(str).str.replace(",", ".", regex = False)
    df["longitude"] = pd.to_numeric(df["longitude"], errors = "coerce")
    df["latitude"] = df["latitude"].astype(str).str.replace(",", ".", regex = False)
    df["latitude"] = pd.to_numeric(df["latitude"], errors = "coerce")

    df["month"] = df["month"].astype(str)

    df.insert(0, "record_id", range(record_id, record_id + len(df)))
    record_id += len(df)

    if first_file:
        df.to_sql("crimes", conn, if_exists = "replace", index= False)
        first_file = False
    else:
        df.to_sql("crimes", conn, if_exists ="append", index = False)

    total_rows += len(df)

print("created db crime_data")
print("rows num:", total_rows)


cursor = conn.cursor()

# remove column context since all the values are missing in this column
cursor.execute("ALTER TABLE crimes DROP COLUMN context")

conn.commit()

# remove northern ireland since the lsoa names are missing and cannot be used for clustering 
cursor.execute("""DELETE FROM crimes
WHERE reported_by = 'Police Service of Northern Ireland'
""")

conn.commit()

# remove duplicate rows where all attributes match except outcome
# if one record has 'Status update unavailable', delete it and keep the more informative outcome
cursor.execute("""DELETE FROM crimes
               where rowid IN (
               select c.rowid
               from crimes c
               where c.crime_id IS NOT NULL AND c.last_outcome_category = 'Status update unavailable'
               AND EXISTS (SELECT 1
               from crimes c2
               where c2.crime_id = c.crime_id
                and c2.month = c.month
                and c2.reported_by = c.reported_by
                and c2.falls_within = c.falls_within
                and c2.longitude = c.longitude
                and c2.latitude = c.latitude
                and c2.location = c.location
                and c2.lsoa_code = c.lsoa_code
                and c2.lsoa_name = c.lsoa_name
                and c2.crime_type = c.crime_type
                and c2.last_outcome_category != 'Status update unavailable'));""")

conn.commit()

# cursor.execute("vacuum into 'crime_data.sqlite'")

conn.close()