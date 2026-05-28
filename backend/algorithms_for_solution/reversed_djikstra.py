import polyline
import googlemaps

import os
from dotenv import load_dotenv

parent_dir = os.path.dirname(os.path.dirname(__file__))
env_path = os.path.join(parent_dir, '../important_stuff_APIs', '.env')
load_dotenv(dotenv_path=env_path)

api_key = os.getenv("GOOGLE_MAPS_API_KEY")
gmaps = googlemaps.Client(key=api_key)

def find_nearest_officers(no_officers, officers, dest):
    assert no_officers <= len(officers), "The required officers for a case should be less than or equal than the number of officers on active duty"
    routes = {}

    for i in range(len(officers)):
        directions = gmaps.directions(
            officers[i],
            dest,
            mode="driving",
            departure_time="now"
        )

        route = directions[0]
        leg = route["legs"][0]
        officer_route = polyline.decode(route["overview_polyline"]["points"])

        routes[i] = {
            "traffic_duration_s": leg["duration_in_traffic"]["value"],
            "route": officer_route
        }

    sorted_drivers = sorted(
        routes.items(),
        key=lambda item: item[1]["traffic_duration_s"]
    )

    result = [officers[element[0]] for element in sorted_drivers][:no_officers]
    routes = [officers[element[1]] for element in sorted_drivers][:no_officers]

    return result

def test_find_nearest_officer():
    officers = {
        0: (51.9244, 4.4777),
        1: (52.3676, 4.9041),
        2: (51.5719, 4.7683)
    }

    dest  = (51.4416, 5.4697)
    result, routes = find_nearest_officers(2, officers, dest)

    for element in result:
        print(f"Officer at location {element}")

test_find_nearest_officer()