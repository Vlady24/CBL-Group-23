from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import socketio
from pydantic import BaseModel

#from algorithms_for_solution import kmeans, patrol_routing, reversed_djikstra

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

# API endpoints

@app.post("/phase1/generate-zones")
async def generate_daily_zones(data : OfficerAllocation):
    # Trigger for phase 1: K-means shift planning
    print(f"Running K-means to allocate {data.officers_available} officers")

    # import and call the K-means algorithm here

    return {"status": "success", "message": "Zones generated", "zones": []}

@app.post("/phase2/generate-route/{officer_id}")
async def generate_patrol_route(officer_id : int):
    # Trigger for phase 2: TSP routine patrol
    print(f"Running TSP for Officer {officer_id}")

    # import and call TSP algorithm here

    return {"status": "success", "officer_id": officer_id, "route": []}

# WebSocket Events (real-time communication)

@sio.on('connect')
async def connect(sid, environ):
    print(f"Client connected: {sid}")

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

