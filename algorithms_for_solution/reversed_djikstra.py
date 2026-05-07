# Still needs to be better adjusted for the project
import requests
import polyline

import os
from dotenv import load_dotenv

parent_dir = os.path.dirname(os.path.dirname(__file__))
env_path = os.path.join(parent_dir, 'important_stuff_APIs', '.env')
load_dotenv(dotenv_path=env_path)

api_key = os.getenv("GOOGLE_MAPS_API_KEY")

# OpenStreetsMaps
def calculate_route_osm(source, dest):
    start = f"{source[0]},{source[1]}"
    end = f"{dest[0]},{dest[1]}"

    url = (
        f"http://router.project-osrm.org/route/v1/driving/"
        f"{start};{end}"
        f"?overview=full&geometries=geojson"
    )

    response = requests.get(url)

    if response.status_code != 200:
        raise Exception(f"API Error: {response.status_code}")

    data = response.json()

    route = data['routes'][0]
    coordinates = route['geometry']['coordinates']

    return coordinates

# Google Maps
def calculate_route_gm(source, dest):
    url = "https://routes.googleapis.com/directions/v2:computeRoutes"

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": (
            "routes.distanceMeters,"
            "routes.duration,"
            "routes.polyline.encodedPolyline"
        )
    }

    body = {
        "origin": {
            "location": {
                "latLng": {
                    "latitude": source[1],
                    "longitude": source[0]
                }
            }
        },
        "destination": {
            "location": {
                "latLng": {
                    "latitude": dest[1],
                    "longitude": dest[0]
                }
            }
        },
        "travelMode": "DRIVE"
    }

    response = requests.post(url, headers=headers, json=body)
    data = response.json()

    route = data['routes'][0]
    encoded = route['polyline']['encodedPolyline']

    coordinates = polyline.decode(encoded)

    return [(x[1], x[0]) for x in coordinates]

source = (-83.920699, 35.96061) # Knoxville 
dest  = (-73.973846, 40.71742)  # New York City

print(calculate_route_gm(source, dest))