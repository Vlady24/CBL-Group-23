import googlemaps
from datetime import datetime
import glob
import os
from dotenv import load_dotenv
import pandas as pd

# The distance matrix API is used according to the following information:
#
# https://developers.google.com/maps/documentation/distance-matrix
#
# https://developers.google.com/maps/documentation/distance-matrix/distance-matrix
# 
# https://github.com/googlemaps/google-maps-services-python


# finding the exact path of the folder where the .env is located
# go up one level to the parent directory, then into important_stuff_APIs
parent_dir = os.path.dirname(os.path.dirname(__file__))
env_path = os.path.join(parent_dir, 'important_stuff_APIs', '.env')
load_dotenv(dotenv_path=env_path)

api_key = os.getenv("GOOGLE_MAPS_API_KEY")
gmaps = googlemaps.Client(key=api_key)

# API request and matrix construction
# updated with batch chunking due to API limit
def get_live_matrix(station, lsoas):
    print("Getting live traffic data from Google Maps")

    # combine the station and LSOAs into a single list of nodes
    all_nodes = [station] + lsoas
    total_nodes = len(all_nodes)

    # Standard API limit is 100 elements per request.
    # We dynamically calculate how many origins we can send per batch against all destinations.
    max_origins_per_chunk = 100 // total_nodes

    master_rows = []

    # Chunk through the origins safely
    for i in range(0, total_nodes, max_origins_per_chunk):
        origin_chunk = all_nodes[i : i + max_origins_per_chunk]

        matrix_chunk = gmaps.distance_matrix(
            origins=origin_chunk,
            destinations=all_nodes,
            mode="driving",
            departure_time=datetime.now(),
        )

        # extend our master list with the rows from this batch
        master_rows.extend(matrix_chunk["rows"])

    # reconstruct unified response payload
    matrix_response = {"rows": master_rows, "status": "OK"}

    return matrix_response, all_nodes

# nearest-neighbour TSP algorithm
def calculate_active_deterrence_route(matrix_response, all_nodes):
    print('Calculating optimal patrol route')

    num_nodes = len(all_nodes)
    unvisited = set(range(1, num_nodes)) # nodes 1 to H

    current_node_index = 0 # start at station
    total_route_time_seconds = 0
    route_sequence = [all_nodes[0]] # add station to start of route

    # greedy loop
    while unvisited:
        nearest_neighbour = None
        shortest_time = float('inf') # infinite

        # evaluate all remaining LSOAs
        for candidate_index in unvisited:
            # extract live travel time in seconds from gmaps response
            element = matrix_response['rows'][current_node_index]['elements'][candidate_index]

            # is this node reacheable by car?
            if element.get('status') != 'OK':
                continue # skip and test the next candidate

            travel_time = element['duration_in_traffic']['value']

            # find the minimum
            if travel_time < shortest_time:
                shortest_time = travel_time
                nearest_neighbour = candidate_index
        
        # move to the nearest neighbour
        current_node_index = nearest_neighbour
        unvisited.remove(nearest_neighbour)
        total_route_time_seconds += shortest_time
        route_sequence.append(all_nodes[current_node_index])
    
    # add the trip back to the station to close the loop
    return_time = matrix_response['rows'][current_node_index]['elements'][0]['duration_in_traffic']['value']
    total_route_time_seconds += return_time
    route_sequence.append(all_nodes[0])

    # converting seconds to minutes
    total_minutes = round(total_route_time_seconds / 60, 2)

    return {
        "master_patrol_loop" : route_sequence,
        "total_route_time_minutes" : total_minutes
    }


# Reads the raw merged CSV files for West Midlands Police
# applies severity weights, and extracts the top high-crime LSOAs.
def get_hotspots_from_csv(csv_folder, limit=15):
    print(f"Reading local CSV files to extract the top {limit} Birmingham (West Midlands) hotspots")

    # defining public safety weights
    weights = {
        "Violence and sexual offences": 10,
        "Robbery": 8,
        "Possession of weapons": 8,
        "Burglary": 7,
        "Drugs": 5,
        "Criminal damage and arson": 4,
        "Public order": 4,
        "Vehicle crime": 3,
        "Theft from the person": 3,
        "Shoplifting": 2,
        "Anti-social behaviour": 2,
        "Other crime": 2,
    }

    # matching the exact headers from raw files
    needed_cols = [
        "LSOA code",
        "LSOA name",
        "Latitude",
        "Longitude",
        "Crime type",
    ]
    target_dfs = []

    # Targeting West Midlands Police files explicitly via glob matching logic
    file_patterns = ["*west*midlands*.csv"]

    for pattern in file_patterns:
        search_path = os.path.join(csv_folder, pattern)
        matching_files = glob.glob(search_path)

        if not matching_files:
            print(f"Warning: no CSV file found matching: {pattern}")
            continue

        file_path = matching_files[0]
        try:
            # reading exact columns, dropping rows missing GPS coordinates
            df = pd.read_csv(file_path, usecols=needed_cols).dropna(
                subset=["Latitude", "Longitude", "LSOA code"]
            )
            target_dfs.append(df)
            print(f"Successfully loaded: {os.path.basename(file_path)}")

        except Exception as e:
            print(f"Error reading {file_path}: {e}")

    if not target_dfs:
        raise FileNotFoundError(
            "\n Error: could not load any West Midlands CSV files.\n"
            f"Please verify your files exist inside: {csv_folder}"
        )

    # concatenate
    full_df = pd.concat(target_dfs, ignore_index=True)

    # mapping the weights (defaulting to 1 for unlisted volume crimes)
    full_df["severity_weight"] = (
        full_df["Crime type"].map(weights).fillna(1).astype(int)
    )

    # grouping by exact original LSOA headers to sum up the score
    hotspots = (
        full_df.groupby(["LSOA code", "LSOA name", "Latitude", "Longitude"])[
            "severity_weight"
        ]
        .sum()
        .reset_index()
    )

    # standardizing output names so routing code doesn't break
    hotspots = hotspots.rename(
        columns={
            "LSOA code": "lsoa_code",
            "LSOA name": "lsoa_name",
            "Latitude": "latitude",
            "Longitude": "longitude",
            "severity_weight": "severity_score",
        }
    )

    top_hotspots = hotspots.sort_values(
        by="severity_score", ascending=False
    ).head(limit)

    return top_hotspots


# testing using real CSV targets from the cleaned folder
def run_csv_patrol():
    parent_dir = os.path.dirname(os.path.dirname(__file__))
    csv_folder = os.path.join(parent_dir, "police_data_cleaned")

    # fetching real target data from the pre-cleaned files
    hotspots_df = get_hotspots_from_csv(csv_folder, limit=15)

    # Birmingham Central Depot station coordinates (Lloyd House HQ)
    police_station = {
        "lat": 52.4831,
        "lng": -1.8966,
        "name": "Birmingham Central HQ Depot",
    }

    target_lsoas = []
    for _, row in hotspots_df.iterrows():
        target_lsoas.append(
            {
                "lat": row["latitude"],
                "lng": row["longitude"],
                "name": row["lsoa_name"],
                "score": row["severity_score"],
            }
        )

    # executing existing network request
    matrix, nodes = get_live_matrix(police_station, target_lsoas)

    # executing existing TSP computation
    results = calculate_active_deterrence_route(matrix, nodes)

    # output
    print(
        f"\nTotal Patrol Time: {results['total_route_time_minutes']} minutes"
    )
    print("Optimal Birmingham Visiting Order:")

    for step, node in enumerate(results["master_patrol_loop"]):
        if step == 0 or step == len(results["master_patrol_loop"]) - 1:
            print(
                f"{step}. Depot: {node['name']} ({node['lat']}, {node['lng']})"
            )
        else:
            print(
                f"{step}. Patrol Target: {node['name']} [Severity Score: {node['score']}]"
            )

if __name__ == "__main__":
    run_csv_patrol()