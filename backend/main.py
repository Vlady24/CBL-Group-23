from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import socketio
from pydantic import BaseModel

from algorithms_for_solution import patrol_routing, kmeans, reversed_djikstra

app = FastAPI(title="Active Deterrence Dispatch Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Socket.IO with ASGI mode and CORS
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')

# Data Models
class OfficerAllocation(BaseModel):
    officers_available : int

class EmergencyTrigger(BaseModel):
    lat : float
    lng : float
    officers_needed : int
    incident_id : str | None = None
    active_car_ids : list[str] | None = None

class PatrolRouteRequest(BaseModel):
    police_force : str
    start_lat : float
    start_lng : float
    start_name : str = "Current patrol start"
    limit : int = 15

# dummy live police fleet coordinates for testing purposes
live_police_fleet = {
    "Car 101": (52.4862, -1.8904),
    "Car 102": (52.5050, -1.8350),
    "Car 103": (52.5280, -1.9180),
    "Car 104": (52.4710, -1.8720),
    "Car 105": (52.4640, -1.9460)
}

fleet_status = {
    "Car 101": "available",
    "Car 102": "responding",
    "Car 103": "patrolling",
    "Car 104": "scene",
    "Car 105": "patrolling",
}

def normalize_car_id(car_id):
    return str(car_id).replace("_", " ")

def fleet_status_payload():
    return {
        car_id: {
            "lat": location[0],
            "lng": location[1],
            "status": fleet_status.get(car_id, "available")
        }
        for car_id, location in live_police_fleet.items()
    }

def patrol_route_payload(route_data):
    return {
        "master_patrol_loop": [
            {
                "lat": float(node["lat"]),
                "lng": float(node["lng"]),
                "name": str(node["name"]),
                **({"score": float(node["score"])} if "score" in node else {})
            }
            for node in route_data["master_patrol_loop"]
        ],
        "road_route": [
            {
                "lat": float(point["lat"]),
                "lng": float(point["lng"])
            }
            for point in route_data.get("road_route", [])
        ],
        "total_route_time_minutes": float(route_data["total_route_time_minutes"])
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

@app.post("/phase2/generate-route")
async def generate_patrol_route(data : PatrolRouteRequest):
    # Trigger for phase 2: TSP routine patrol
    print(f"Running TSP patrol route for {data.police_force}")

    police_station = {
        "lat": data.start_lat,
        "lng": data.start_lng,
        "name": data.start_name
    }

    try:
        route_data = patrol_routing.run_db_patrol(
            police_force=data.police_force,
            police_station=police_station,
            limit=data.limit
        )
        route_payload = patrol_route_payload(route_data)

        return {
            "status" : "success",
            "route_data" : route_payload,
            "message" : "Patrol route calculated."
        }
    
    except Exception as e:
        # if the db file is not found or the API fails
        # we prevent the server from crashing
        print(f"Error running TSP: {e}")
        return {
            "status" : "error",
            "message" : str(e)
        }

@app.post("/phase3/deploy-officers")
async def deploy_nearest_officers(data : EmergencyTrigger):
    print(
        f"Running Reversed Dijkstra for incident {data.incident_id or 'unknown'} "
        f"at {data.lat}, {data.lng}; officers needed: {data.officers_needed}"
    )

    try:
        active_car_ids = (
            {normalize_car_id(car_id) for car_id in data.active_car_ids}
            if data.active_car_ids
            else None
        )
        available_fleet = {
            car_id: location
            for car_id, location in live_police_fleet.items()
            if active_car_ids is None or car_id in active_car_ids
            if fleet_status.get(car_id, "available") in {"available", "patrolling"}
        }

        if data.officers_needed < 1:
            raise ValueError("officers_needed must be at least 1")

        if data.officers_needed > len(available_fleet):
            raise ValueError(
                f"Not enough available officers "
                f"({len(available_fleet)} available, {data.officers_needed} requested)"
            )

        assignments = reversed_djikstra.find_nearest_officers(
            no_officers=data.officers_needed,
            officers=available_fleet,
            dest=(data.lat, data.lng)
        )

        assigned_officers = []

        for assignment in assignments:
            car_id = assignment["officer_id"]
            fleet_status[car_id] = "responding"
            assigned_officers.append({
                "car_id": car_id,
                "status": "responding",
                "location": {
                    "lat": assignment["officer_location"][0],
                    "lng": assignment["officer_location"][1]
                },
                "traffic_duration_s": assignment["traffic_duration_s"],
                "route": [
                    {"lat": lat, "lng": lng}
                    for lat, lng in assignment["route"]
                ]
            })

        payload = {
            "incident_id": data.incident_id,
            "destination": {
                "lat": data.lat,
                "lng": data.lng
            },
            "assigned_officers": assigned_officers
        }

        await sio.emit("deployment_update", payload)
        await sio.emit("fleet_status_update", fleet_status_payload())

        return {
            "status": "success",
            "data": payload
        }
    
    except Exception as e:
        print(f"Error running Reversed Dijkstra: {e}")
        return {
            "status": "error",
            "message": str(e)
        }

# WebSocket Events (real-time communication)

@sio.on('connect')
async def connect(sid, environ):
    print(f"Client connected: {sid}")
    await sio.emit("fleet_status_update", fleet_status_payload(), to=sid)

@sio.on('update_location')
async def update_car_location(sid, data):
    # listens for live GPS ping from police cars on patrol

    car_id = normalize_car_id(data.get('car_id'))
    lat = data.get('lat')
    lng = data.get('lng')
    status = data.get('status')

    if car_id and lat and lng:
        # update car's coordinates in server's memory
        live_police_fleet[car_id] = (lat, lng)
        fleet_status.setdefault(car_id, "available")
        if status in {"available", "patrolling", "responding", "scene"}:
            fleet_status[car_id] = status
        print(f"GPS Update: {car_id} moved to ({lat}, {lng})")

        # broadcast the new location to dispatcher's map
        await sio.emit('fleet_update', live_police_fleet)
        await sio.emit("fleet_status_update", fleet_status_payload())

@sio.on('replace_fleet')
async def replace_fleet(sid, data):
    next_fleet = data.get("fleet", [])

    if not isinstance(next_fleet, list):
        return

    live_police_fleet.clear()
    fleet_status.clear()

    for car in next_fleet:
        car_id = normalize_car_id(car.get("car_id"))
        lat = car.get("lat")
        lng = car.get("lng")
        status = car.get("status")

        if not car_id or lat is None or lng is None:
            continue

        live_police_fleet[car_id] = (lat, lng)
        fleet_status[car_id] = status if status in {"available", "patrolling", "responding", "scene"} else "available"

    await sio.emit('fleet_update', live_police_fleet)
    await sio.emit("fleet_status_update", fleet_status_payload())

@sio.on('citizen_sos')
async def handle_emergency(sid, data):

    print(f"raw incoming sos data: {data}")
    # Trigger for phase 3: Reversed Dijkstra
    print(f"Urgent: Citizen SOS received at {data['lat']}, {data['lng']}")

    citizen_details = data.get('details') or data.get('description') or "No specific details typed by citizen."
    crime_type = data.get('crime_type') or "Citizen SOS Emergency"

    # notify the dispatcher dashboard
    await sio.emit('dispatch_alert',
                   {
                       "lat" : data['lat'],
                       "lng" : data['lng'],
                       "message" : "Citizen emergency reported!",
                       "details" : citizen_details,
                       "crime_type" : crime_type
                   })

@sio.on('assign_patrol_route')
async def handle_assign_patrol(sid, data):
    print(f"[SERVER] Dispatcher manually assigned patrol route to {data.get('car_id')}. Broadcasting")
    
    await sio.emit('assign_patrol_route', data)

@sio.on('disconnect')
async def disconnect(sid):
    print(f"Client disconnected: {sid}")

app = socketio.ASGIApp(sio, other_asgi_app=app)
