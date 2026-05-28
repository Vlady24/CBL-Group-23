from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import socketio
from pydantic import BaseModel

from algorithms_for_solution import patrol_routing, kmeans

app = FastAPI(title="Active Deterrence Dispatch Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
socket_app = socketio.ASGIApp(sio, app)

# Data Models
class OfficerAllocation(BaseModel):
    officers_available : int

class EmergencyTrigger(BaseModel):
    lat : float
    lng : float
    officers_needed : int

# dummy live police fleet coordinates for testing purposes
live_police_fleet = {
    "Car_101": (51.9244, 4.4777),
    "Car_102": (52.3676, 4.9041),
    "Car_103": (51.5719, 4.7683),
    "Car_104": (51.4416, 5.4697)
}

# API endpoints

@app.post("/phase1/generate-zones")
async def generate_daily_zones(data : OfficerAllocation):
    # Trigger for phase 1: K-means shift planning
    print(f"Running K-means to allocate {data.officers_available} officers")

    # import and call the K-means algorithm here
    try:
        result = kmeans.run_kmeans(n_clusters = data.officers_available)
        return {
            "status" : "success",
            "data" : result
        }
    
    except Exception as e:
        print(f"Error running K-Means: {e}")
        return {
            "status" : "error",
            "message" : str(e)
        }

@app.post("/phase2/generate-route/{officer_id}")
async def generate_patrol_route(officer_id : int):
    # Trigger for phase 2: TSP routine patrol
    print(f"Running TSP for Officer {officer_id}")

    # define the starting police station (this cann be passed from the fronted later)
    police_station = {
        "lat": 52.4831,
        "lng": -1.8966,
        "name": "Birmingham Central HQ Depot"
    }

    try:
        route_data = patrol_routing.run_db_patrol(
            police_force="West Midlands Police",
            police_station=police_station,
            limit=15
        )

        return {
            "status" : "success",
            "officer_id" : officer_id,
            "route_data" : route_data,
            "message" : "Patrol route calculated. Check server console for route details."
        }
    
    except Exception as e:
        # if the db file is not found or the API fails
        # we prevent the server from crashing
        print(f"Error running TSP: {e}")
        return {
            "status" : "error",
            "message" : str(e)
        }

# WebSocket Events (real-time communication)

@sio.on('connect')
async def connect(sid, environ):
    print(f"Client connected: {sid}")

@sio.on('update_location')
async def update_car_location(sid, data):
    # listens for live GPS ping from police cars on patrol

    car_id = data.get('car_id')
    lat = data.get('lat')
    lng = data.get('lng')

    if car_id and lat and lng:
        # update car's coordinates in server's memory
        live_police_fleet[car_id] = (lat, lng)
        print(f"GPS Update: {car_id} moved to ({lat}, {lng})")

        # broadcast the new location to dispatcher's map
        await sio.emit('fleet_update', live_police_fleet)

@sio.on('citizen_sos')
async def handle_emergency(sid, data):
    # Trigger for phase 3: Reversed Dijkstra
    print(f"Urgent: Citizen SOS received at {data['lat']}, {data['lng']}")

    # import and call Reversed Dijkstra function here

    # notify the dispatcher dashboard
    await sio.emit('dispatch_alert',
                   {
                       "lat" : data['lat'],
                       "lng" : data['lng'],
                       "message" : "Citizen emergency reported!"
                   })

@sio.on('disconnect')
async def disconnect(sid):
    print(f"Client disconnected: {sid}")

# mounting the socket app
# this ensures FastAPI and Socket.IO run on the same port
app.mount("/", socket_app)