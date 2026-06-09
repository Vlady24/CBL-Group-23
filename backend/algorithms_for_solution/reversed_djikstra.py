import polyline
import googlemaps

import os
from datetime import datetime
from dotenv import load_dotenv

parent_dir = os.path.dirname(os.path.dirname(__file__))
env_path = os.path.join(parent_dir, '../important_stuff_APIs', '.env')
load_dotenv(dotenv_path=env_path, override=True)

api_key = os.getenv("GOOGLE_MAPS_API_KEY")
if not api_key:
    raise RuntimeError(f"GOOGLE_MAPS_API_KEY was not found in {env_path}")

gmaps = googlemaps.Client(key=api_key)

def find_nearest_officers(no_officers, officers, dest):
    if no_officers > len(officers):
        raise ValueError("The required officers for a case should be less than or equal than the number of officers on active duty")

    routes = {}

    officer_items = list(officers.items()) if isinstance(officers, dict) else list(enumerate(officers))

    for officer_id, officer_location in officer_items:
        directions = gmaps.directions(
            officer_location,
            dest,
            mode="driving",
            departure_time=datetime.now(),
            traffic_model="best_guess",
        )

        if not directions:
            continue

        route = directions[0]
        leg = route["legs"][0]
        officer_route = polyline.decode(route["overview_polyline"]["points"])
        duration = leg.get("duration_in_traffic", leg["duration"])["value"]
        distance = leg["distance"]["value"]

        routes[officer_id] = {
            "officer_id": officer_id,
            "officer_location": officer_location,
            "traffic_duration_s": duration,
            "distance_m": distance,
            "route": officer_route
        }

    if len(routes) < no_officers:
        raise ValueError("Not enough reachable officers found for this incident")

    sorted_drivers = sorted(
        routes.items(),
        key=lambda item: item[1]["traffic_duration_s"]
    )

    # result = [element[1] for element in sorted_drivers[:no_officers]]  old version 
    result = [
    {
        "officer_id": element[0],
        "officer_location": officers[element[0]],
        "traffic_duration_s": element[1]["traffic_duration_s"],
        "distance_m": element[1]["distance_m"] if "distance_m" in element[1] else None,         # new version needed for ratio sim
        "route": element[1]["route"],
    }
    for element in sorted_drivers[:no_officers]
    ] 
    return result

def test_find_nearest_officer():
    officers = {
        0: (51.9244, 4.4777),
        1: (52.3676, 4.9041),
        2: (51.5719, 4.7683)
    }

    dest  = (51.4416, 5.4697)
    result = find_nearest_officers(2, officers, dest)
    result = find_nearest_officers(2, officers, dest)

    for element in result:
        print(f"Officer at location {element}")

if __name__ == "__main__":
    test_find_nearest_officer()
