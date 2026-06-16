from pathlib import Path
import sqlite3
import numpy as np
import pandas as pd
import os
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans

# resolve paths relative to this file, so it works regardless of where it's called from
_BASE_DIR = Path(__file__).resolve().parent          
def _resolve_db_path(base_dir):
    for name in ("crime_data.sqlite", "crime_data.db"):
        candidate = base_dir / "database" / name
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        "No database found. Expected crime_data.sqlite or crime_data.db "
        f"in {base_dir / 'database'}"
    )

_DB_PATH = _resolve_db_path(_BASE_DIR.parent)
_OUT_DIR  = _BASE_DIR / "algorithms_for_solution"    

# Executes the k-means clustering algorithm on crime data
# It is wrapped in a function so it can be called by the FastAPI server
def run_kmeans(n_clusters=4):
    print(f"Starting K-means clustering for {n_clusters} zones")

    try:
        
        conn = sqlite3.connect(str(_DB_PATH))

        df = pd.read_sql_query("""select c.lsoa_code, c.lsoa_name, c.month, c.crime_type, c.latitude, c.longitude, c.reported_by, p.population
                            from crimes c
                            join population p
                            on c.lsoa_code = p.lsoa_code
                            where c.lsoa_code is not null
                            and c.lsoa_name is not null
                            and p.population is not null
                            and p.population > 0""", conn)
        conn.close()
    
    except Exception as e:
        print(f"Database Error: {e}")
        return {
            "error" : "Could not connect to database"
        }

    # os.makedirs("../visualizations", exist_ok= True)
    os.makedirs("algorithms_for_solution", exist_ok = True)

    df["month"] = pd.to_datetime(df["month"])
    df["crime_type"] = df["crime_type"].str.lower().str.strip()

    months= sorted(df["month"].unique())
    total_months = len(months)

    # create a table with one row per lsoa
    base = df.groupby("lsoa_code", as_index = False).agg(lsoa_name = ("lsoa_name", "first"),
        population = ("population", "first"), latitude = ("latitude", "mean"), longitude = ("longitude", "mean"), reported_by=("reported_by", "first"))

    # feaures for clustering
    mcount = df.groupby(["lsoa_code", "month"]).size().reset_index(name= "monthly_crime_count")

    grid = pd.MultiIndex.from_product([base["lsoa_code"], months], names = ["lsoa_code", "month"])
    mf = mcount.set_index(["lsoa_code", "month"]).reindex(grid, fill_value = 0).reset_index()
    mf = mf.merge(base[["lsoa_code", "population"]], on = "lsoa_code", how = "left")

    #monthly crime rate per 1000 residents
    mf["monthly_rate_per_1000"] = mf["monthly_crime_count"] / mf["population"] *1000

    mstats = mf.groupby("lsoa_code", as_index = False).agg(monthly_mean_rate_per_1000 = ("monthly_rate_per_1000", "mean"),
        monthly_std_rate_per_1000 = ("monthly_rate_per_1000", "std"))

    mstats["coefficient_of_variation"] = mstats["monthly_std_rate_per_1000"] / mstats["monthly_mean_rate_per_1000"]
    mstats["coefficient_of_variation"] = mstats["coefficient_of_variation"].replace([np.inf, -np.inf], np.nan).fillna(0)

    # take log of monthly crime rate to reduce skewness
    mstats["log_monthly_mean_rate_per_1000"] = np.log1p(mstats["monthly_mean_rate_per_1000"])

    mf["mn"] = mf["month"].dt.month
    summer = mf[mf["mn"].isin([6, 7, 8])].groupby("lsoa_code", as_index = False).agg(summer_avg=("monthly_rate_per_1000", "mean"))
    winter = mf[mf["mn"].isin([12, 1, 2])].groupby("lsoa_code", as_index = False).agg(winter_avg= ("monthly_rate_per_1000", "mean"))
    season = summer.merge(winter, on = "lsoa_code", how = "outer")
    season["summer_winter_ratio"] = season["summer_avg"] / season["winter_avg"].replace(0, np.nan)
    season["summer_winter_ratio"] = season["summer_winter_ratio"].replace([np.inf, -np.inf], np.nan).fillna(0)

    crime_count = df.groupby("lsoa_code", as_index = False).size()
    crime_count = crime_count.rename(columns = {"size": "crime_count"})

    types = df.groupby(["lsoa_code", "crime_type"]).size().reset_index(name = "n")
    tp = types.pivot_table(index = "lsoa_code", columns = "crime_type", values = "n", fill_value = 0).reset_index()
    tp = tp.merge(crime_count, on = "lsoa_code", how = "left")

    crime_cols = {
        "violence and sexual offences": "violence_share",
        "anti-social behaviour": "asb_share",
        "burglary": "burglary_share",
        "shoplifting": "shoplifting_share",
        "vehicle crime": "vehicle_crime_share",
        "other theft": "other_theft_share",
        "drugs": "drugs_share",
        "theft from the person": "theft_from_person_share",
        "possession of weapons": "possession_of_weapons_share"}

    for old, new in crime_cols.items():
        if old in tp.columns:
            tp[new] = tp[old] / tp["crime_count"]
        else:
            tp[new] = 0

    share_cols = list(crime_cols.values())

    # merge derived features into lsoa-level dataset
    lsoa_features = base.merge(crime_count, on= "lsoa_code", how = "left")
    lsoa_features = lsoa_features.merge(mstats, on = "lsoa_code", how = "left")
    lsoa_features = lsoa_features.merge(season[["lsoa_code", "summer_winter_ratio"]], on = "lsoa_code", how = "left")
    lsoa_features = lsoa_features.merge(tp[["lsoa_code"] + share_cols], on = "lsoa_code", how = "left")
    lsoa_features["crime_count"] = lsoa_features["crime_count"].fillna(0)

    for c in share_cols:
        lsoa_features[c] = lsoa_features[c].fillna(0)

    lsoa_features["summer_winter_ratio"] = lsoa_features["summer_winter_ratio"].fillna(0)

    #plot feature distrs to check skewness 
    # fig, ax = plt.subplots(2, 2, figsize = (12, 8))

    # ax[0, 0].hist(lsoa_features["monthly_mean_rate_per_1000"], bins = 50)
    # ax[0, 0].set_title("monthly_mean_rate_per_1000")
    # ax[0, 1].hist(lsoa_features["log_monthly_mean_rate_per_1000"], bins = 50)
    # ax[0, 1].set_title("log_monthly_mean_rate_per_1000")
    # ax[1, 0].hist(lsoa_features["coefficient_of_variation"], bins = 50)
    # ax[1, 0].set_title("coefficient_of_variation")
    # ax[1, 1].hist(lsoa_features["summer_winter_ratio"], bins= 50)
    # ax[1, 1].set_title("summer_winter_ratio")
    # plt.tight_layout()
    # plt.savefig("../visualizations/feature_distrs.png", dpi = 300, bbox_inches = "tight")
    # plt.close()

    # check if there are pairs of features with high correlation
    # corr_cols = ["log_monthly_mean_rate_per_1000",
    #     "coefficient_of_variation", "summer_winter_ratio", "violence_share", "asb_share",
    #     "burglary_share", "shoplifting_share", "vehicle_crime_share", "other_theft_share",
    #     "drugs_share", "theft_from_person_share", "possession_of_weapons_share"]

    # corr = lsoa_features[corr_cols].corr()

    # plt.figure(figsize = (12, 9))
    # sns.heatmap(corr, annot = True, fmt = ".2f", cmap = "coolwarm", center = 0)
    # plt.title("Feature correlation heatmap")
    # plt.tight_layout()
    # plt.savefig("../visualizations/correlation_heatmap.png", dpi = 300, bbox_inches = "tight")
    # plt.close()

    # calculate data coverage for each lsoa: lsoas with a lot of missing data can distort clustering
    coverage = df.groupby("lsoa_code", as_index = False).agg(months_with_records = ("month", "nunique"))

    coverage["missing_months"] = total_months - coverage["months_with_records"]
    coverage["share_months_with_records"] = coverage["months_with_records"] / total_months
    lsoa_features = lsoa_features.merge(coverage, on = "lsoa_code", how = "left")
    lsoa_features["months_with_records"] = lsoa_features["months_with_records"].fillna(0)
    lsoa_features["missing_months"] = lsoa_features["missing_months"].fillna(total_months)
    lsoa_features["share_months_with_records"] = lsoa_features["share_months_with_records"].fillna(0)

    # exclude lsoas that have records in less than half of the months
    susp_lsoas = lsoa_features[lsoa_features["months_with_records"] < total_months * 0.5].copy()
    print("\nexcluded from clustering:", susp_lsoas["lsoa_code"].nunique())

    cv_cap = lsoa_features["coefficient_of_variation"].quantile(0.99)
    lsoa_features["coefficient_of_variation_capped"] = lsoa_features["coefficient_of_variation"].clip(upper = cv_cap)

    # FINAL SET OF FEATURES used for the clustering algorithm 
    features = [
        "log_monthly_mean_rate_per_1000",
        "coefficient_of_variation_capped",
        "violence_share",
        "asb_share",
        "burglary_share",
        "shoplifting_share",
        "vehicle_crime_share"]

    # exclude sparse lsoas
    cl = lsoa_features[~lsoa_features["lsoa_code"].isin(susp_lsoas["lsoa_code"])].copy()
    cl = cl.replace([np.inf, -np.inf], np.nan)
    cl = cl.dropna(subset = features)
    X = cl[features]

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # perform clustering
    kmeans = KMeans(n_clusters = n_clusters, random_state = 42, n_init = 10)
    cl["cluster"] = kmeans.fit_predict(X_scaled)

    # Save outputs
    #lsoa_features.to_csv("algorithms_for_solution/lsoa_features.csv", index=False)
    #cl.to_csv(str(_BASE_DIR.parent / "database" / "lsoa_features_with_clusters.csv"), index=False)  # needed for ratio output, and save in database folder, so uncomment for that purpose

    print ("K-Means calculation complete. Files saved")

    map_data = cl[["lsoa_code", "lsoa_name", "latitude", "longitude", "cluster"]].to_dict(orient="records")

    # return a summary dict and the map data to the API
    return {
        "status" : "success",
        "clusters_generated" : n_clusters,
        "lsoas_clustered" : len(cl),
        "excluded_sparse_lsoas" : susp_lsoas["lsoa_code"].nunique(),
        "map_data" : map_data # react will use this to draw the map
    }

if __name__ == "__main__":
    result = run_kmeans(n_clusters=4)
    print(result)


# choose optimal number of clusters by the elbow method
""" ks = range(2, 11)
inertias = []

for k in ks:
    km = KMeans(n_clusters = k, random_state = 42, n_init = 10)
    km.fit(X_scaled)
    inertias.append(km.inertia_)

plt.figure(figsize = (8, 5))
plt.plot(ks, inertias, marker = "o")
plt.xlabel("Number of clusters (k)")
plt.ylabel("Inertia")
plt.title("Elbow Method for Choosing Number of Clusters")
plt.xticks(list(ks))
plt.grid(True)
plt.tight_layout()
plt.savefig("visualizations/elbow_method.png", dpi = 300, bbox_inches = "tight")
plt.show()

kmeans = KMeans(n_clusters = 4, random_state = 42, n_init = 10)
cl["cluster"] = kmeans.fit_predict(X_scaled)

print("\ncluster counts:")
print(cl["cluster"].value_counts().sort_index())

lsoa_features.to_csv("algorithms_for_solution/lsoa_features.csv", index = False)
cl.to_csv("algorithms_for_solution/lsoa_features_with_clusters.csv", index = False)

cluster_profile = cl.groupby("cluster").agg(number_of_lsoas = ("lsoa_code", "nunique"),
    log_monthly_mean_rate_per_1000 = ("log_monthly_mean_rate_per_1000", "mean"),
    coefficient_of_variation_capped = ("coefficient_of_variation_capped", "mean"),
    violence_share = ("violence_share", "mean"),
    asb_share = ("asb_share", "mean"),
    burglary_share = ("burglary_share", "mean"),
    shoplifting_share = ("shoplifting_share", "mean"),
    vehicle_crime_share = ("vehicle_crime_share", "mean")).reset_index()

print("\ncluster profile")
print(cluster_profile)

# bar chart to compare clusters
plot_df = cluster_profile[
    ["cluster", "log_monthly_mean_rate_per_1000", "coefficient_of_variation_capped",
    "violence_share", "asb_share", "burglary_share", "shoplifting_share", "vehicle_crime_share"]].copy()

plot_df = plot_df.set_index("cluster")

plot_df.plot(kind = "bar", figsize = (13, 7))

plt.title("Cluster profiles")
plt.xlabel("Cluster")
plt.ylabel("Average feature value")
plt.xticks(rotation = 0)
plt.legend(title = "Feature", bbox_to_anchor = (1.02, 1), loc = "upper left")
plt.tight_layout()
plt.savefig("visualizations/cluster_profiles.png", dpi = 300, bbox_inches = "tight")
plt.show() """
