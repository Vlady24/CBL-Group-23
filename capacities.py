import pandas as pd
import sqlite3
from pathlib import Path

# reads .odf file and extracts the following:
# force name + FTE for sep24, mar25, sep25
# exports file to other_data folder
def read_and_export_capacities(sheet : str, filepath : str):
    df_workforce = pd.read_excel(filepath, engine='odf', sheet_name=sheet, header=4)

    df_capacity = df_workforce.iloc[:, [0, 1, 2, 3, 4]].copy()
    df_capacity.columns = ['PFA_code', 'Force_Name', 'FTE_Sep24', 'FTE_Mar25', 'FTE_Sep25']

    # dropping regional subtotals
    df_capacity = df_capacity[df_capacity['PFA_code'].astype(str).str.startswith(('E23', 'W'), na=False)]

    df_capacity = df_capacity[df_capacity['Force_Name'] != 'Wales']

    # dropping PFA code
    df_capacity = df_capacity.drop(columns=['PFA_code'])

    cols_to_round = ['FTE_Sep24', 'FTE_Mar25', 'FTE_Sep25']
    df_capacity[cols_to_round] = df_capacity[cols_to_round].round(0).astype(int)

    df_capacity.to_csv(f'other_data/historical_capacity_baseline_{sheet}.csv', index=False)

read_and_export_capacities('Table_1', 'other_data/police-workforce-sep25-tables-280126.ods')
read_and_export_capacities('Table_3', 'other_data/police-workforce-sep25-tables-280126.ods')

# Takes the two csv files exported above and merges them
# on the column 'Force_Name'
# 
# Moreover it calculates for each date the total capacity as FTE
def merge_and_export(filepath1 : str, filepath2 : str):
    df_officers = pd.read_csv(filepath1)
    df_pcsos = pd.read_csv(filepath2)

    df_officers = df_officers.rename(columns={
        'FTE_Sep24': 'Officer_Sep24',
        'FTE_Mar25': 'Officer_Mar25',
        'FTE_Sep25': 'Officer_Sep25'
    })

    df_pcsos = df_pcsos.rename(columns={
        'FTE_Sep24': 'PCSO_Sep24',
        'FTE_Mar25': 'PCSO_Mar25',
        'FTE_Sep25': 'PCSO_Sep25'
    })

    # merging
    df_merged = pd.merge(df_officers, df_pcsos, on='Force_Name', how='inner')

    # calculate total capacity for each date
    dates = ['Sep24', 'Mar25', 'Sep25']

    for date in dates:
        df_merged[f'Total_Frontline_{date}'] = df_merged[f'Officer_{date}'] + df_merged[f'PCSO_{date}']
    
    df_merged.to_csv('other_data/historical_capacity_merged.csv', index=False)

merge_and_export('other_data/historical_capacity_baseline_Table_1.csv', 
                 'other_data/historical_capacity_baseline_Table_3.csv')

# add the table with polioce force capacities to the database 

df = pd.read_csv("CBL-Group-23/other_data/historical_capacity_merged.csv")
conn = sqlite3.connect("CBL-Group-23/crime_data.db")

df.to_sql("capacity", conn, if_exists = "replace", index = False)

conn.commit()
conn.close()
