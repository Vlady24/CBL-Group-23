import googlemaps
import polyline
from datetime import datetime
import glob
import os
from dotenv import load_dotenv
import pandas as pd
import sqlite3

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
env_path = os.path.join(parent_dir, '../important_stuff_APIs', '.env')
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


def get_road_route(route_sequence):
    print("Getting road route geometry from Google Maps")

    road_route = []

    for start, end in zip(route_sequence, route_sequence[1:]):
        directions = gmaps.directions(
            origin=(start["lat"], start["lng"]),
            destination=(end["lat"], end["lng"]),
            mode="driving",
            departure_time=datetime.now(),
            traffic_model="best_guess",
        )

        if not directions:
            raise ValueError(
                f"No road route found between {start['name']} and {end['name']}"
            )

        leg_points = polyline.decode(directions[0]["overview_polyline"]["points"])
        leg_route = [{"lat": lat, "lng": lng} for lat, lng in leg_points]

        if road_route and leg_route:
            leg_route = leg_route[1:]

        road_route.extend(leg_route)

    return road_route


# Reads the sqlite database, applies severity weights, 
# and extracts the top high-crime LSOAs without duplicates
def get_hotspots_from_db(db_path, police_force, limit=15):

    # defining public safety weights
    weights = {
        "Violence and sexual offences": 10,
        "Robbery": 8,
        "Possession of weapons": 9,
        "Burglary": 6.5,
        "Drugs": 6.5,
        "Criminal damage and arson": 6.5,
        "Public order": 3.5,
        "Vehicle crime": 3,
        "Theft from the person": 3,
        "Shoplifting": 1.5,
        "Anti-social behaviour": 3.5,
        "Other crime": 5,
    }

    conn = sqlite3.connect(db_path)

    query = """select lsoa_code, lsoa_name, latitude, longitude, crime_type
    from crimes
    where reported_by = ?
    and lsoa_code is not null
    and lsoa_name is not null
    and latitude is not null
    and longitude is not null
    and crime_type is not null
    """

    df = pd.read_sql_query(query, conn, params=[police_force])
    conn.close()

    if df.empty:
        raise ValueError(
            f"No crime records found for police force: {police_force}. "
            "Check the exact value in the reported_by column."
        )

    df["severity_weight"] = (
        df["crime_type"].map(weights).fillna(1).astype(int)
    )

    hotspots = (
        df.groupby(["lsoa_code", "lsoa_name"])
        .agg(
            severity_score=("severity_weight", "sum"),
            latitude=("latitude", "mean"),
            longitude=("longitude", "mean"),
        )
        .reset_index()
    )

    top_hotspots = hotspots.sort_values(
        by="severity_score", ascending=False
    ).head(limit)

    return top_hotspots


# testing using crime data from the SQLite database
def run_db_patrol(police_force, police_station, limit=15):
    backend_dir = os.path.dirname(os.path.dirname(__file__))
    db_path = os.path.join(backend_dir, "database", "crime_data.db")

    hotspots_df = get_hotspots_from_db(
        db_path=db_path,
        police_force=police_force,
        limit=limit
    )

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

    matrix, nodes = get_live_matrix(police_station, target_lsoas)

    results = calculate_active_deterrence_route(matrix, nodes)
    results["road_route"] = get_road_route(results["master_patrol_loop"])

    print(f"\nPolice force: {police_force}")
    print(f"Total Patrol Time: {results['total_route_time_minutes']} minutes")
    print("Optimal Visiting Order:")

    for step, node in enumerate(results["master_patrol_loop"]):
        if step == 0 or step == len(results["master_patrol_loop"]) - 1:
            print(f"{step}. Depot: {node['name']} ({node['lat']}, {node['lng']})")
        else:
            print(f"{step}. Patrol Target: {node['name']} [Severity Score: {node['score']}]")

    return results


# test for the West Midlands Police, but do not hardcode it in functions
if __name__ == "__main__":
    police_station = {
        "lat": 52.4831,
        "lng": -1.8966,
        "name": "Birmingham Central HQ Depot"}

    run_db_patrol(police_force = "West Midlands Police", police_station = police_station, limit = 15)   
