## This simulation is not used for the report results, since changes were needed after some progress in the project. The simulation in the report are: 
## Validation_model.py, which is the robust simulation, and sanity_check.py is the simulation that uses google maps and gave the ETA estimation we looked at. 

import sqlite3
import pandas as pd
import numpy as np
from math import radians, sin, cos, sqrt, atan2
from datetime import datetime, time
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from pathlib import Path
import os
import sys
from algorithms_for_solution.reversed_djikstra import find_nearest_officers as _gmaps_find_nearest

# setup
BASE_DIR = Path(__file__).resolve().parent
def _resolve_db_path(base_dir):
    for name in ("crime_data.sqlite", "crime_data.db"):
        candidate = base_dir / "database" / name
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        "No database found. Expected crime_data.sqlite or crime_data.db "
        f"in {base_dir / 'database'}"
    )
DB_PATH = _resolve_db_path(BASE_DIR) # now it should work for all teammates
CAPACITY_FILE = (BASE_DIR.parent/"other_data"/"historical_capacity_merged.csv")
CLUSTER_FILE = (BASE_DIR / "database" / "lsoa_features_with_clusters.csv")
CLUSTER_CSV = BASE_DIR / "database" / "lsoa_features_with_clusters.csv"

# config
ACTIVE_FRACTION = 0.03     # fraction of total officers to simulate as active who can respond to emergencies
RANDOM_SEED = 42
N_TSP_STOPS = 15
SHIFT_HOURS = 8
N_SIMULATIONS = 10   # how many shifts to simulate per ratio, increase for more robust results but longer runtime
MAX_RESPONSE_MINUTES = 15  # acceptable response time threshold in minutes

def get_force_capacity(force_name): # more realistic simulation based on actual staffing levels of the chosen force
    """
    Returns number of officers to simulate for a force.
    Uses Officer_Sep25 from historical_capacity_merged.csv.
    """
    capacity = pd.read_csv(CAPACITY_FILE)
    row = capacity[
        capacity["Force_Name"] == force_name
    ]
    if row.empty:
        raise ValueError(
            f"No staffing data found for {force_name}"
        )
    total_officers = int(
        row["Officer_Sep25"].iloc[0]
    )
    simulated_officers = max(
        10,
        int(total_officers * ACTIVE_FRACTION)
    )
    return simulated_officers

def estimate_events_per_hour(lsoa_coords): # more realistic event generation based on crime volume in the area
    """
    Estimate emergency demand from crime volume.
    """
    total_crimes = lsoa_coords['crime_count'].sum()
    crimes_per_day = total_crimes / 30
    emergency_events_per_day = crimes_per_day * 0.10

    return emergency_events_per_day / 24

# Ratios to test: (patrol_fraction, station_fraction)
DEPLOYMENTS = [
    ("100% Patrol", 0.0, 0.0, 1.0),
    ("10/10/80", 0.1, 0.1, 0.8),
    ("20/10/70", 0.2, 0.1, 0.7),
    ("10/20/70", 0.1, 0.2, 0.7),
    ("30/10/60", 0.3, 0.1, 0.6),
]

# Haversine 
def haversine(coord1, coord2):
    R = 6371
    lat1, lon1 = map(radians, coord1)
    lat2, lon2 = map(radians, coord2)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = sin(dlat/2)**2 + cos(lat1)*cos(lat2)*sin(dlon/2)**2
    return R * 2 * atan2(sqrt(a), sqrt(1-a))

# STEP 1: Choose police force
def choose_force():
    capacity = pd.read_csv(CAPACITY_FILE)

    forces = sorted(
        capacity["Force_Name"].dropna().unique()
    )

    print("\nAvailable police forces:\n")

    for i, force in enumerate(forces, start=1):
        print(f"{i}. {force}")

    choice = int(input("\nChoose force number: "))

    return forces[choice - 1]

# STEP 2: Load data 
def load_data(db_path, force_name):
    """
    Loads LSOA coordinates, crime counts, and cluster assignments
    from the database. Connects directly to the K-means output table
    if available, otherwise falls back to raw crime counts.
    """
    conn = sqlite3.connect(db_path)

    tables = pd.read_sql(
        "SELECT name FROM sqlite_master WHERE type='table'",
        conn
    )
    print("\nTables in database:")
    print(tables)

    # Load LSOA coordinates and crime counts
    lsoa_coords = pd.read_sql(
    """
    SELECT c.lsoa_code,
           AVG(c.latitude)  AS latitude,
           AVG(c.longitude) AS longitude,
           COUNT(*)         AS crime_count
    FROM crimes c
    WHERE c.falls_within = ?
      AND c.lsoa_code IS NOT NULL
      AND c.latitude IS NOT NULL
      AND c.longitude IS NOT NULL
    GROUP BY c.lsoa_code
    """,
    conn,
    params=(force_name,)
)

    # Try to load K-means cluster assignments
    # Replace 'lsoa_features_with_clusters' with your actual
    # saved CSV path or table name if different
    # Load K-means cluster assignments
    if CLUSTER_CSV.exists():
        clusters = pd.read_csv(
            CLUSTER_CSV,
            usecols=['lsoa_code', 'cluster', 'log_monthly_mean_rate_per_1000']
        )
        lsoa_coords = lsoa_coords.merge(clusters, on='lsoa_code', how='left')
        lsoa_coords["cluster"] = lsoa_coords["cluster"].fillna(0).astype(int)
        lsoa_coords["log_monthly_mean_rate_per_1000"] = lsoa_coords[
            "log_monthly_mean_rate_per_1000"
        ].fillna(np.log1p(lsoa_coords["crime_count"]))
        print("K-means cluster assignments loaded successfully.")
    else:
        print("[KMeans] Cluster CSV not found — falling back to raw crime count.")
        lsoa_coords['cluster'] = 0
        lsoa_coords['log_monthly_mean_rate_per_1000'] = np.log1p(lsoa_coords['crime_count'])

    conn.close()
    print(f"Loaded {len(lsoa_coords)} LSOAs."
          f"for {force_name}")
    return lsoa_coords

# STEP 3: Derive station and event pool 
def derive_station(lsoa_coords):
    """
    Derives station location as the centroid of all LSOA coordinates.
    No hardcoded location needed.
    """
    station = {
        'name':      'Operational Base',
        'latitude':   lsoa_coords['latitude'].mean(),
        'longitude':  lsoa_coords['longitude'].mean()
    }
    print(f"Station at: ({station['latitude']:.4f}, {station['longitude']:.4f})")
    return station

def build_event_pool(lsoa_coords, n_top=100):
    """
    Builds a weighted pool of event locations for the simulation.
    Events are sampled from the top crime LSOAs, weighted by crime count,
    so emergencies are more likely to occur in genuinely high-crime areas.
    """
    top = lsoa_coords.nlargest(n_top, 'crime_count').copy()
    top['weight'] = top['crime_count'] / top['crime_count'].sum()
    print(f"Event pool built from top {n_top} LSOAs by crime count.")
    return top

# STEP 4: Simulate officers 
def simulate_officers(lsoa_coords, n, seed=RANDOM_SEED):
    """
    Simulates officer starting locations weighted by crime count.
    Officers are more likely to start in higher-crime areas.
    """
    np.random.seed(seed)

    weights = lsoa_coords['crime_count'] / lsoa_coords['crime_count'].sum()
    sampled = lsoa_coords.sample(
        n,
        weights=weights,
        random_state=seed,
        replace=True
    ).reset_index(drop=True)

    # Data-driven offset scale
    lat_range = lsoa_coords['latitude'].max()  - lsoa_coords['latitude'].min()
    lon_range = lsoa_coords['longitude'].max() - lsoa_coords['longitude'].min()
    offset    = min(lat_range, lon_range) * 0.01

    sampled['latitude']  += np.random.uniform(-offset, offset, n)
    sampled['longitude'] += np.random.uniform(-offset, offset, n)

    sampled['officer_id'] = range(1, n + 1)
    sampled['role']       = np.random.choice(
        ['response', 'specialist', 'PCSO'],
        n,
        p=[0.60, 0.25, 0.15]
    )
    return sampled[['officer_id', 'latitude', 'longitude', 'role']].copy()

#Step 5: Split officers into patrol, custer fixed and station
def build_deployment(
    officers,
    lsoa_coords,
    station_location,
    station_ratio,
    cluster_ratio,
    patrol_ratio,
    seed=RANDOM_SEED
):

    shuffled = officers.sample(
        frac=1,
        random_state=seed
    ).reset_index(drop=True)

    n_total = len(shuffled)

    n_station = round(n_total * station_ratio)
    n_cluster = round(n_total * cluster_ratio)
    n_patrol = n_total - n_station - n_cluster

    station = shuffled.iloc[:n_station].copy()

    cluster = shuffled.iloc[
        n_station:n_station+n_cluster
    ].copy()

    patrol = shuffled.iloc[
        n_station+n_cluster:
    ].copy()

    # station officers

    station["latitude"] = station_location["latitude"]
    station["longitude"] = station_location["longitude"]

    # cluster fixed officers

    cluster_summary = (
        lsoa_coords.groupby("cluster")
        .agg(
            latitude=("latitude", "mean"),
            longitude=("longitude", "mean"),
            crime=("crime_count", "sum")
        )
        .sort_values("crime", ascending=False)
    )

    top_clusters = cluster_summary.head(
        max(1, len(cluster))
    ).reset_index()

    for i in range(len(cluster)):

        row = top_clusters.iloc[
            min(i, len(top_clusters)-1)
        ]

        cluster.iloc[i, cluster.columns.get_loc("latitude")] = row["latitude"]

        cluster.iloc[i, cluster.columns.get_loc("longitude")] = row["longitude"]

    return patrol, cluster, station

# STEP 6: Generate events for one shift 
def generate_events(event_pool, events_per_hour, shift_hours=SHIFT_HOURS, seed=None):
    """
    Generates a random sequence of emergency events for one simulated shift.
    Events are sampled from the event pool weighted by crime count.
    Timing follows a Poisson process — realistic for emergency arrivals.
    """
    rng = np.random.default_rng(seed)

    # Poisson process: random number of events
    n_events = rng.poisson(events_per_hour * shift_hours)

    if n_events == 0:
        return pd.DataFrame()

    # Sample event locations weighted by crime count
    sampled = event_pool.sample(
        n_events,
        weights='weight',
        replace=True,
        random_state=seed
    ).reset_index(drop=True)

    # Random event times uniformly distributed across the shift
    sampled['time_hours'] = np.sort(
        rng.uniform(0, shift_hours, n_events)
    )

    # Severity based on crime count — higher crime areas generate
    # more severe events
    sampled['severity'] = pd.cut(
        sampled['crime_count'],
        bins=3,
        labels=['low', 'medium', 'high']
    )

    return sampled[['lsoa_code', 'latitude', 'longitude',
                     'time_hours', 'severity']].copy()

# STEP 7: Find nearest available officer 
def find_nearest_officer(event, available_officers):
    """
    Finds the nearest available officer to an event.
    Uses reversed_djikstra.py (Google Maps Directions API) for real road
    travel times. Falls back to haversine at 40 km/h if the API fails.
    """
    if available_officers.empty:
        return None, float('inf')

    event_coord = (event['latitude'], event['longitude'])

    # Pre-filter to 5 closest by haversine to limit API calls
    hav_distances = available_officers.apply(
    lambda row: haversine(event_coord, (row['latitude'], row['longitude'])), axis=1
)

    # Only use Google Maps for high severity events
    if event.get('severity') != 'high':
        nearest_idx = hav_distances.idxmin()
        travel_time_min = (hav_distances[nearest_idx] / 40) * 60
        return nearest_idx, travel_time_min

    candidates = available_officers.loc[
        hav_distances.nsmallest(min(5, len(available_officers))).index
    ]

    # Build officer dict ...
    idx_map = {}
    officer_dict = {}
    for i, (df_idx, row) in enumerate(candidates.iterrows()):
        officer_dict[i] = (row['latitude'], row['longitude'])
        idx_map[i] = df_idx

    dest = (event['latitude'], event['longitude'])

    try:
        nearest_locations = _gmaps_find_nearest(1, officer_dict, dest)
        best = nearest_locations[0]

        travel_time_min = best['traffic_duration_s'] / 60

        best_coord = best['officer_location']
        for i, coord in officer_dict.items():
            if coord == best_coord:
                return idx_map[i], travel_time_min

        print("[Dispatch] Coordinate match failed — falling back to haversine.")
        nearest_idx = hav_distances.idxmin()
        travel_time_min = (hav_distances[nearest_idx] / 40) * 60
        return nearest_idx, travel_time_min

    except Exception as e:
        print(f"[Dispatch] Google Maps API call failed ({e}) — falling back to haversine.")
        nearest_idx = hav_distances.idxmin()
        travel_time_min = (hav_distances[nearest_idx] / 40) * 60
        return nearest_idx, travel_time_min

# STEP 8: Simulate one shift
def simulate_shift(patrol_officers, cluster_officers, station_officers, event_pool,
                   events_per_hour, shift_hours=SHIFT_HOURS, seed=None):
    """
    Simulates one full shift.
    Station officers handle emergency dispatch.
    When a station officer is dispatched, they become temporarily
    unavailable for the duration of their response.
    Returns response times and coverage metrics.
    """
    print(f"Generated {len(events)} events in {time.time()-start:.2f}s")
    events = generate_events(event_pool, events_per_hour=events_per_hour, shift_hours=shift_hours, seed=seed)

    if events.empty:
        return {
            'n_events':            0,
            'n_responded':         0,
            'n_unresponded':       0,
            'mean_response_time':  0,
            'max_response_time':   0,
            'pct_within_threshold': 100.0
        }

    # Track availability — officers start fully available
    available = pd.concat([patrol_officers, cluster_officers, station_officers], ignore_index=True)
    available['available_at'] = 0.0

    response_times  = []
    unresponded     = 0

    start = time.time()

    for _, event in events.iterrows():
        current_time = event['time_hours']

        # Officers who have finished their previous response
        # are now available again
        free = available[available['available_at'] <= current_time]
        free_patrol = free[free['officer_id'].isin(officers['officer_id'])]

        if free.empty:
            unresponded += 1
            continue

        if not free_patrol.empty:
            nearest_idx, travel_time_min = find_nearest_officer(event, free_patrol)
        else:
            nearest_idx, travel_time_min = find_nearest_officer(event, free)

        if nearest_idx is None:
            unresponded += 1
            continue

        response_times.append(travel_time_min)

        # Officer is now busy for the duration of their response
        # Assume 30 min average on-scene time after arrival
        travel_time_hours = travel_time_min / 60
        available.loc[nearest_idx, 'available_at'] = (
            current_time + travel_time_hours + 0.5
        )

    if not response_times:
        return {
            'n_events':             len(events),
            'n_responded':          0,
            'n_unresponded':        len(events),
            'mean_response_time':   float('inf'),
            'max_response_time':    float('inf'),
            'pct_within_threshold': 0.0
        }

    response_times = np.array(response_times)

    return {
        'n_events':             len(events),
        'n_responded':          len(response_times),
        'n_unresponded':        unresponded,
        'mean_response_time':   np.mean(response_times),
        'max_response_time':    np.max(response_times),
        'pct_within_threshold': np.mean(
            response_times <= MAX_RESPONSE_MINUTES
        ) * 100
    }

# STEP 9: Run full ratio comparison
def run_ratio_comparison(officers, lsoa_coords, station_location, event_pool, events_per_hour, deployments=DEPLOYMENTS,
                          n_simulations=N_SIMULATIONS):
    """
    Runs N_SIMULATIONS shifts for each patrol/station ratio.
    Aggregates results and returns a summary DataFrame.
    """
    results = []

    for deployment_name, station_frac, cluster_frac, patrol_frac in deployments:
        print(f"\nTesting ratio — Patrol: {int(patrol_frac*100)}% | "
              f"Station: {int(station_frac*100)}%")

        patrol, cluster, station = build_deployment(officers, lsoa_coords, station_location, station_frac, cluster_frac, patrol_frac)
        station['latitude']  = station_location['latitude']
        station['longitude'] = station_location['longitude']

        n_patrol  = len(patrol)
        n_station = len(station)
        print(f"  Officers on patrol: {n_patrol} | At station: {n_station}")

        shift_results = []
        for sim in range(n_simulations):
            result = simulate_shift(
                patrol, cluster, station, event_pool, events_per_hour, seed=RANDOM_SEED + sim
            )
            shift_results.append(result)

        df_shifts = pd.DataFrame(shift_results)

        results.append({
            "deployment": deployment_name,
            "station_pct": int(station_frac * 100),
            "cluster_pct": int(cluster_frac * 100),
            "patrol_pct": int(patrol_frac * 100),
            'n_patrol':                n_patrol,
            'n_station':               n_station,
            'mean_response_time':      df_shifts['mean_response_time'].mean(),
            'std_response_time':       df_shifts['mean_response_time'].std(),
            'max_response_time':       df_shifts['max_response_time'].mean(),
            'pct_within_threshold':    df_shifts['pct_within_threshold'].mean(),
            'mean_unresponded':        df_shifts['n_unresponded'].mean(),
            'pct_unresponded':         (
                df_shifts['n_unresponded'].sum() /
                df_shifts['n_events'].sum() * 100
            )
        })

        print(f"  Mean response time:       "
              f"{results[-1]['mean_response_time']:.2f} min")
        print(f"  % within {MAX_RESPONSE_MINUTES} min threshold: "
              f"{results[-1]['pct_within_threshold']:.1f}%")
        print(f"  % events unresponded:     "
              f"{results[-1]['pct_unresponded']:.1f}%")

    return pd.DataFrame(results)

# STEP 10: Visualise results
def plot_results(summary_df, n_officers):
    """
    Produces three plots:
    1. Mean response time per ratio
    2. Percentage of events responded to within threshold
    3. Percentage of events unresponded
    """
    labels = [f"{row['patrol_pct']}/{row['station_pct']}"
              for _, row in summary_df.iterrows()]

    fig, axes = plt.subplots(1, 3, figsize=(15, 5))
    fig.suptitle(
        f'Patrol vs Station Ratio Simulation\n'
        f'({n_officers} officers, {N_SIMULATIONS} shifts, '
        f'{SHIFT_HOURS}h shift)',
        fontsize=13, fontweight='bold'
    )

    # Plot 1 — Mean response time
    bars1 = axes[0].bar(labels,
                         summary_df['mean_response_time'],
                         color='steelblue', edgecolor='white')
    axes[0].axhline(MAX_RESPONSE_MINUTES, color='red',
                     linestyle='--', label=f'{MAX_RESPONSE_MINUTES} min threshold')
    axes[0].set_title('Mean Response Time (min)')
    axes[0].set_xlabel('Patrol / Station Ratio')
    axes[0].set_ylabel('Minutes')
    axes[0].legend()

    # Add value labels on bars
    for bar in bars1:
        axes[0].text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + 0.1,
            f'{bar.get_height():.1f}',
            ha='center', va='bottom', fontsize=10
        )

    # Plot 2 — % within threshold
    bars2 = axes[1].bar(labels,
                         summary_df['pct_within_threshold'],
                         color='seagreen', edgecolor='white')
    axes[1].axhline(90, color='red', linestyle='--',
                     label='90% target')
    axes[1].set_title(f'% Events Within {MAX_RESPONSE_MINUTES} Min')
    axes[1].set_xlabel('Patrol / Station Ratio')
    axes[1].set_ylabel('Percentage (%)')
    axes[1].set_ylim(0, 105)
    axes[1].legend()

    for bar in bars2:
        axes[1].text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + 0.5,
            f'{bar.get_height():.1f}%',
            ha='center', va='bottom', fontsize=10
        )

    # Plot 3 — % unresponded
    bars3 = axes[2].bar(labels,
                         summary_df['pct_unresponded'],
                         color='firebrick', edgecolor='white')
    axes[2].set_title('% Events Unresponded')
    axes[2].set_xlabel('Patrol / Station Ratio')
    axes[2].set_ylabel('Percentage (%)')

    for bar in bars3:
        axes[2].text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + 0.1,
            f'{bar.get_height():.1f}%',
            ha='center', va='bottom', fontsize=10
        )

    plt.tight_layout()
    plt.savefig('ratio_simulation_results.png', dpi=300, bbox_inches='tight')
    plt.show()
    print("Plot saved to ratio_simulation_results.png")

# STEP 10: Print summary table
def print_summary(summary_df):
    print("\n" + "="*65)
    print("SIMULATION SUMMARY")
    print("="*65)
    print(f"{'Ratio':<12} {'Mean RT':>10} {'Std RT':>10} "
          f"{'% ≤'+str(MAX_RESPONSE_MINUTES)+'min':>12} {'% Unresponded':>15}")
    print("-"*65)

    for _, row in summary_df.iterrows():
        label = f"{row['patrol_pct']}/{row['station_pct']}"
        print(f"{label:<12} "
              f"{row['mean_response_time']:>10.2f} "
              f"{row['std_response_time']:>10.2f} "
              f"{row['pct_within_threshold']:>12.1f}% "
              f"{row['pct_unresponded']:>14.1f}%")

    print("="*65)

    # Recommend the best ratio
    # Define best as highest % within threshold
    # while keeping unresponded below 5%
    candidates = summary_df[summary_df['pct_unresponded'] <= 5.0]

    if candidates.empty:
        best = summary_df.loc[summary_df['pct_within_threshold'].idxmax()]
        print("\nNote: no ratio keeps unresponded events below 5%.")
    else:
        best = candidates.loc[candidates['pct_within_threshold'].idxmax()]

    print(f"\nRecommended ratio: "
          f"{best['patrol_pct']}% patrol / {best['station_pct']}% station")
    print(f"  Mean response time:          {best['mean_response_time']:.2f} min")
    print(f"  % within {MAX_RESPONSE_MINUTES} min threshold: "
          f"{best['pct_within_threshold']:.1f}%")
    print(f"  % events unresponded:        {best['pct_unresponded']:.1f}%")

# Main
if __name__ == '__main__':

    # Load data
    print("Loading data...")
    force_name = choose_force()
    print(f"\nSelected force: {force_name}")

    print(f"\nUsing police force: {force_name}")

    lsoa_coords = load_data(DB_PATH, force_name)

    # Derive station and event pool from data
    station    = derive_station(lsoa_coords)
    event_pool = build_event_pool(lsoa_coords)

    events_per_hour = estimate_events_per_hour(lsoa_coords)
    print(f"\nEstimated emergency events per hour: {events_per_hour:.2f}")

    # Simulate officers
    print("\nSimulating officers...")
    n_officers = get_force_capacity(force_name)
    print(
        f"\nSimulating {n_officers} officers "
        f"for {force_name}"
    )
    officers = simulate_officers(
        lsoa_coords,
        n=n_officers
    )

    # Run ratio comparison
    print("\nRunning ratio simulation...")
    summary = run_ratio_comparison(officers, lsoa_coords, station, event_pool, events_per_hour)

    # Output
    print_summary(summary)
    plot_results(summary, n_officers)


    # Save results
    summary.to_csv('ratio_simulation_results.csv', index=False)
    print("\nResults saved to ratio_simulation_results.csv")