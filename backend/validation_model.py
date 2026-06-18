import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from math import radians, sin, cos, sqrt, atan2

# Configuration
CSV_PATH = "backend/database/lsoa_features_with_clusters.csv"
FORCE_NAME = "West Midlands Police"
N_INCIDENTS = 10000
N_OFFICERS = 20
AVERAGE_RESPONSE_SPEED_KMH = 50
RESPONSE_TARGET_MIN = 15
RANDOM_SEED = 42

np.random.seed(RANDOM_SEED)

# Distance calculation using Haversine formula
def haversine(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = (sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2)
    return 2 * R * atan2(sqrt(a), sqrt(1 - a))

def eta_minutes(distance_km):
    return (distance_km / AVERAGE_RESPONSE_SPEED_KMH * 60) * 1.8 # road factor in urban areas
# LOAD DATA
print("Loading CSV...")

df = pd.read_csv(CSV_PATH)
required = [
    "reported_by",
    "latitude",
    "longitude",
    "crime_count",
    "cluster"
]

for col in required:
    if col not in df.columns:
        raise ValueError(f"Missing column: {col}")

df = df[df["reported_by"] == FORCE_NAME].copy()

df = df.dropna(
    subset=[
        "latitude",
        "longitude",
        "crime_count",
        "cluster"
    ]
)
print(f"Loaded {len(df)} LSOAs")

crime_weights = (
    df["crime_count"]
    / df["crime_count"].sum()
)

# Incident Sampling
incidents = df.sample(n=N_INCIDENTS, weights=crime_weights, replace=True, random_state=RANDOM_SEED)

# Cluster summary
cluster_summary = (
    df.groupby("cluster")
    .agg(
        latitude=("latitude", "mean"),
        longitude=("longitude", "mean"),
        crime=("crime_count", "sum")
    )
    .sort_values("crime", ascending=False)
)

# Fleet Creation
def create_fleet(station_ratio, cluster_ratio, patrol_ratio):
    n_station = round(N_OFFICERS * station_ratio)
    n_cluster = round(N_OFFICERS * cluster_ratio)
    n_patrol = (N_OFFICERS- n_station- n_cluster)
    officers = []

    # Station Officers
    station_lat = df["latitude"].mean()
    station_lon = df["longitude"].mean()

    for _ in range(n_station):
        officers.append((station_lat, station_lon))

    # Cluster Officers
    top_clusters = cluster_summary.head(max(1, n_cluster))
    for _, row in top_clusters.iterrows():
        officers.append((row["latitude"], row["longitude"]))

    # Patrol Officers
    if n_patrol > 0:
        patrol_sample = df.sample(n=n_patrol, weights=crime_weights, replace=True)
        for _, row in patrol_sample.iterrows():
            officers.append((row["latitude"], row["longitude"]))
    return officers

# Evaluation
def evaluate_strategy(
    name,
    officers
):
    response_times = []
    for _, incident in incidents.iterrows():
        best_eta = float("inf")
        for officer_lat, officer_lon in officers:
            distance = haversine(incident["latitude"], incident["longitude"], officer_lat, officer_lon)
            eta = eta_minutes(distance)
            if eta < best_eta:
                best_eta = eta
        response_times.append(best_eta)
    response_times = np.array(response_times)

    return {
        "strategy": name,
        "mean_eta": response_times.mean(),
        "median_eta": np.median(response_times),
        "p90_eta": np.percentile(response_times, 90),
        "p95_eta": np.percentile(response_times, 95),
        "pct_under_15": np.mean(response_times <= RESPONSE_TARGET_MIN) * 100
    }
# Strategies to evaluate
strategies = [
    ("100% Patrol", 0.0, 0.0, 1.0),
    ("10% Station / 10% Cluster / 80% Patrol", 0.1, 0.1, 0.8),
    ("20% Station / 10% Cluster / 70% Patrol", 0.2, 0.1, 0.7),
    ("10% Station / 20% Cluster / 70% Patrol", 0.1, 0.2, 0.7),
    ("30% Station / 10% Cluster / 60% Patrol", 0.3, 0.1, 0.6),
    ("10% Station / 30% Cluster / 60% Patrol",0.1 ,0.3, 0.6)]

# Run evaluation
results = []
for (name, station_ratio, cluster_ratio, patrol_ratio) in strategies:
    print(f"Evaluating {name}")

    fleet = create_fleet(station_ratio, cluster_ratio, patrol_ratio)
    results.append(evaluate_strategy(name, fleet)
    )

# Results summary
summary = pd.DataFrame(results)
summary = summary.sort_values("mean_eta")
print()
print("=" * 80)
print("RESULTS")
print("=" * 80)
print(summary)

summary.to_csv("test results/validation_results.csv", index=False)
print("\nSaved validation_results.csv")

# Bar plot
plt.figure(figsize=(12, 6))
plt.bar(summary["strategy"], summary["mean_eta"])
plt.axhline(RESPONSE_TARGET_MIN, linestyle="--")
plt.ylabel("Average Response Time (minutes)")
plt.title(f"{FORCE_NAME}\nFleet Composition Validation")
plt.xticks(rotation=20, ha="right")
plt.tight_layout()
plt.savefig("test results/validation_results.png", dpi=300)
plt.show()
print("Saved validation_results.png")