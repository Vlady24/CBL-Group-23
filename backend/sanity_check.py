import pandas as pd
import numpy as np
import googlemaps
from math import radians, sin, cos, sqrt, atan2

# Configuration

GOOGLE_API_KEY = "AIzaSyA2LQsntWrhMPXnb4lyej2LyR1Nz5uqMV8"

CSV_PATH = "backend/database/lsoa_features_with_clusters.csv"
FORCE_NAME = "West Midlands Police"

N_INCIDENTS = 120
N_OFFICERS = 20

AVERAGE_RESPONSE_SPEED_KMH = 55
ROAD_FACTOR = 1.3

RANDOM_SEED = 42

np.random.seed(RANDOM_SEED)

gmaps = googlemaps.Client(key=GOOGLE_API_KEY)

# Distance functions

def haversine(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = (
        sin(dlat / 2) ** 2
        + cos(radians(lat1))
        * cos(radians(lat2))
        * sin(dlon / 2) ** 2
    )
    return 2 * R * atan2(sqrt(a), sqrt(1 - a))

def haversine_eta(distance_km):
    return distance_km * ROAD_FACTOR / AVERAGE_RESPONSE_SPEED_KMH * 60

def google_eta(origin, destination):
    try:
        result = gmaps.distance_matrix(
            origins=[origin],
            destinations=[destination],
            mode="driving"
        )

        return (
            result["rows"][0]["elements"][0]["duration"]["value"]
            / 60
        )

    except Exception as e:
        print(f"Google error: {e}")
        return np.nan

# Load data

df = pd.read_csv(CSV_PATH)

df = df[df["reported_by"] == FORCE_NAME].copy()

df = df.dropna(
    subset=[
        "latitude",
        "longitude",
        "crime_count",
        "cluster"
    ]
)

crime_weights = df["crime_count"] / df["crime_count"].sum()

# Generate incidents

incidents = df.sample(
    n=N_INCIDENTS,
    weights=crime_weights,
    replace=True,
    random_state=RANDOM_SEED
).iloc[20:]  # Skip first 20 for sanity check

# Cluster summary

cluster_summary = df.groupby("cluster").agg(
    latitude=("latitude", "mean"),
    longitude=("longitude", "mean"),
    crime=("crime_count", "sum")
).sort_values("crime", ascending=False)

# Fleet generation (same as validation)

def create_fleet():

    station_ratio = 0.1
    cluster_ratio = 0.2

    n_station = round(N_OFFICERS * station_ratio)
    n_cluster = round(N_OFFICERS * cluster_ratio)
    n_patrol = N_OFFICERS - n_station - n_cluster

    officers = []

    # Station
    station_lat = df["latitude"].mean()
    station_lon = df["longitude"].mean()

    for _ in range(n_station):
        officers.append((station_lat, station_lon))

    # Cluster fixed
    top_clusters = cluster_summary.head(max(1, n_cluster))

    for _, row in top_clusters.iterrows():
        officers.append((row["latitude"], row["longitude"]))

    # Patrol
    patrol_sample = df.sample(
        n=n_patrol,
        weights=crime_weights,
        replace=True
    )

    for _, row in patrol_sample.iterrows():
        officers.append((row["latitude"], row["longitude"]))

    return officers

# Run sanity check
fleet = create_fleet()

google_times = []
haversine_times = []

for i, (_, incident) in enumerate(incidents.iterrows(), start=1):

    if i % 10 == 0:
        print(f"{i}/{N_INCIDENTS}")

    best_officer = None
    best_distance = float("inf")

    for officer_lat, officer_lon in fleet:

        distance = haversine(
            officer_lat,
            officer_lon,
            incident["latitude"],
            incident["longitude"]
        )

        if distance < best_distance:
            best_distance = distance
            best_officer = (officer_lat, officer_lon)

    hav_eta = haversine_eta(best_distance)

    google_time = google_eta(
        best_officer,
        (incident["latitude"], incident["longitude"])
    )

    if np.isnan(google_time):
        continue

    haversine_times.append(hav_eta)
    google_times.append(google_time)

# Results

results = pd.DataFrame({
    "haversine_eta": haversine_times,
    "google_eta": google_times
})

results.to_csv("google_sanity_check.csv", index=False)

print("\n==========================")
print("SANITY CHECK RESULTS")
print("==========================")

print(f"Mean Haversine ETA : {results['haversine_eta'].mean():.2f} min")
print(f"Mean Google ETA    : {results['google_eta'].mean():.2f} min")

print(
    f"Difference         : "
    f"{results['google_eta'].mean() - results['haversine_eta'].mean():.2f} min"
)

print(
    f"Correlation        : "
    f"{results.corr().iloc[0,1]:.3f}"
)

print("\nSaved google_sanity_check.csv")