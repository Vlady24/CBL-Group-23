import googlemaps
from datetime import datetime

import os
from dotenv import load_dotenv

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
def get_live_matrix(station, lsoas):
    print('Getting live traffic data from google maps')

    # combine the station and LSOAs into a single list of nodes
    # node 0 is always the station
    # nodes from 1 to H are the LSOAs
    all_nodes = [station] + lsoas

    # API request
    matrix_response = gmaps.distance_matrix(
        origins=all_nodes,
        destinations=all_nodes,
        mode="driving",
        departure_time=datetime.now()
    )

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


# testing using dummy coordinates
def test_with_dummy():
    police_station = (51.509865, -0.118092)

    target_lsoas = [
        (51.512344, -0.124567), # Hotspot 1
        (51.507890, -0.135678), # Hotspot 2
        (51.515678, -0.112345), # Hotspot 3
        (51.501234, -0.145678)  # Hotspot 4
    ]

    # network
    matrix, nodes = get_live_matrix(police_station, target_lsoas)

    # computation
    results = calculate_active_deterrence_route(matrix, nodes)

    print(f"Total Patrol Time: {results['total_route_time_minutes']} minutes")
    print("Optimal Visiting Order:")

    for step, coords in enumerate(results['master_patrol_loop']):
        if step == 0 or step == len(results['master_patrol_loop']) - 1:
            print(f"{step}. station: {coords}")
        else:
            print(f"{step}. LSOA Hotspot: {coords}")

test_with_dummy()