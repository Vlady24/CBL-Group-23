import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np
import glob
import os


# creates plots for each cleaned dataset with summary statistics (crime count by category & demand plot)
# check eda_graphs


input_dir = './police_data_cleaned/'
out_dir = './eda_graphs/'

os.makedirs(out_dir, exist_ok=True)

files = glob.glob(f"{input_dir}/*.csv")
sns.set_theme(style="whitegrid")

for f in files:

    # extract force name to use for titles and filenames
    name = os.path.basename(f).replace('_all_months.csv', '').replace('-', ' ').title()
    df = pd.read_csv(f)
    
    fig, axes = plt.subplots(2, 1, figsize=(12, 10))
    
    # top plot: crime type distribution
    counts = df['Crime type'].value_counts()
    sns.barplot(x=counts.values, y=counts.index, hue=counts.index, legend=False, palette="viridis", ax=axes[0])
    axes[0].set_title(f'{name}: Crime Types')
    
    # bottom plot: timeline of total incidents
    trend = df.groupby('Month').size().reset_index(name='count').sort_values('Month')
    sns.lineplot(data=trend, x='Month', y='count', marker='o', color='crimson', ax=axes[1])
    axes[1].set_title(f'{name}: Monthly Trend')
    
    # space out the x-axis labels so they don't overlap
    axes[1].set_xticks(np.arange(0, len(trend), step=3))
    axes[1].tick_params(axis='x', rotation=45)
    
    plt.tight_layout()
    
    # save to folder instead of showing on screen, then close to free up RAM
    plt.savefig(os.path.join(out_dir, f"{name.replace(' ', '_').lower()}_eda.png"))
    plt.close()