import socketio
import asyncio
import random

sio = socketio.AsyncClient()

# City configurations, graders can choose at demo
CITY_CONFIGS = {

    "birmingham": {
        "center": (52.4862, -1.8904),
        "spread": 0.03
    },

    "manchester": {
        "center": (53.4808, -2.2426),
        "spread": 0.03
    },

    "london": {
        "center": (51.5072, -0.1276),
        "spread": 0.05
    },

    "liverpool": {
        "center": (53.4084, -2.9916),
        "spread": 0.03
    },

    "leeds": {
        "center": (53.8008, -1.5491),
        "spread": 0.03
    }
}

# Choosing city for simulation
selected_city = input(
    "Choose city "
    "(birmingham/manchester/london/liverpool/leeds): "
).lower()

if selected_city not in CITY_CONFIGS:
    print("Invalid city selected.")
    exit()

city = CITY_CONFIGS[selected_city]

center_lat, center_lng = city["center"]
spread = city["spread"]

# Generate random officers
police_fleet = {}

NUMBER_OF_OFFICERS = 7

for i in range(NUMBER_OF_OFFICERS):

    lat = center_lat + random.uniform(-spread, spread)
    lng = center_lng + random.uniform(-spread, spread)

    police_fleet[f"Car_{101+i}"] = [lat, lng]


async def drive_around():

    # Connect to running FastAPI server
    await sio.connect('http://127.0.0.1:8000')
    print(f"Simulating patrols in {selected_city.title()}.")
    print("Starting patrol")

    while True:
        for car_id in police_fleet:
            current_lat, current_lng = police_fleet[car_id]
            # Small movement
            current_lat += random.uniform(-0.0015, 0.0015)
            current_lng += random.uniform(-0.0015, 0.0015)

            police_fleet[car_id] = [
                current_lat,
                current_lng
            ]

        # Wait 3 seconds before sending the next GPS ping
        await asyncio.sleep(3)

if __name__ == '__main__':
    asyncio.run(drive_around())