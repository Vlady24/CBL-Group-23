"""
simulate_cars.py  —  Active Deterrence Patrol Simulator
========================================================
Runs as a standalone process alongside main.py.
Connects to the FastAPI/Socket.IO server as a client and drives
a realistic fleet simulation with four officer states:

    patrolling      – officer follows their TSP road_route polyline (real roads, Google Maps)
    cluster_fixed   – officer orbits their assigned K-means cluster centroid
    responding      – officer follows the Reversed Dijkstra road route to an incident
    at_station      – officer is stationary at the police station (cooldown / standby)

Start-up sequence
-----------------
1. Calls kmeans.run_kmeans(n_clusters) — uses the real algorithm against the SQLite DB.
   Returns map_data with {lsoa_code, lsoa_name, latitude, longitude, cluster} per LSOA.
   Derives cluster centroids and groups LSOAs per cluster from this output.

2. Each officer is assigned a cluster. A configurable fraction become cluster_fixed.
   Patrolling officers each call patrol_routing.run_db_patrol() to get a real
   Google Maps TSP route. They follow the road_route polyline step by step.

3. On receiving a dispatch_alert, the sim calls reversed_djikstra.find_nearest_officers()
   using current officer positions. The chosen officer follows the returned road polyline
   to the incident, then transitions to at_station for a cooldown.

Socket.IO events emitted to server
-----------------------------------
    update_location      – {car_id, lat, lng}              (existing, consumed by main.py)
    officer_state_update – {car_id, state, lat, lng, ...}  (new, for dashboard)

Socket.IO events consumed from server
---------------------------------------
    dispatch_alert       – {lat, lng, crime_type, details}
"""

import asyncio
import random
import math
import sys
import os
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
import socketio

_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from algorithms_for_solution import patrol_routing


try:
    from algorithms_for_solution import reversed_djikstra as _reversed_djikstra_module
    DIJKSTRA_AVAILABLE = True
except RuntimeError as _e:
    print(f"[SIM] Warning: reversed_djikstra unavailable ({_e}). "
          f"Emergency dispatch will use straight-line fallback.")
    _reversed_djikstra_module = None
    DIJKSTRA_AVAILABLE = False

# Configuration


SERVER_URL          = "http://127.0.0.1:8000"
GPS_TICK_SECONDS    = 2       # how often each car emits its position
MOVEMENT_STEP       = 0.0008  # degrees per tick when moving (~70 m)
CLUSTER_ORBIT_RADIUS = 0.004  # degrees radius for cluster_fixed orbit
AT_STATION_COOLDOWN = 20      # ticks at station before resuming patrol
CLUSTER_FIXED_FRACTION = 0.3  # ~30 % of officers are pinned to cluster zones
NUMBER_OF_OFFICERS  = 7       # total officers spawned

# Police force names must match the `reported_by` column in the crimes table
CITY_CONFIGS = {
    "birmingham": {
        "center": (52.4862, -1.8904),
        "police_force": "West Midlands Police",
        "station": {"lat": 52.4831, "lng": -1.8966, "name": "Birmingham Central HQ"},
    },
    "london": {
        "center": (51.5072, -0.1276),
        "police_force": "Metropolitan Police Service",
        "station": {"lat": 51.5074, "lng": -0.1278, "name": "New Scotland Yard"},
    },
    "liverpool": {
        "center": (53.4084, -2.9916),
        "police_force": "Merseyside Police",
        "station": {"lat": 53.4084, "lng": -2.9916, "name": "Liverpool Central"},
    },
    "leeds": {
        "center": (53.8008, -1.5491),
        "police_force": "West Yorkshire Police",
        "station": {"lat": 53.8008, "lng": -1.5491, "name": "Leeds Central"},
    },
}


# State enum
class OfficerState(str, Enum):
    PATROLLING    = "patrolling"
    CLUSTER_FIXED = "cluster_fixed"
    RESPONDING    = "responding"
    AT_STATION    = "at_station"

# Officer dataclass
@dataclass
class Officer:
    car_id: str
    lat: float
    lng: float
    state: OfficerState = OfficerState.PATROLLING

    # Cluster assignment
    cluster_id: int = 0
    cluster_centroid: dict = field(default_factory=dict)   # {lat, lng}

    # Road-route waypoints for patrolling (road_route polyline from TSP)
    # Each entry: {"lat": float, "lng": float}
    patrol_route: list = field(default_factory=list)
    patrol_index: int = 0

    # Road-route waypoints for responding (polyline from Reversed Dijkstra)
    response_route: list = field(default_factory=list)
    response_index: int = 0

    # cluster_fixed orbit angle
    orbit_angle: float = 0.0

    # Incident details while responding
    incident_lat: Optional[float] = None
    incident_lng: Optional[float] = None
    incident_id:  Optional[str]   = None

    # at_station cooldown
    station_ticks_remaining: int = 0
    station_lat: float = 0.0
    station_lng: float = 0.0

# The CSV is written by kmeans.py (the uncommented cl.to_csv line) to:
# CBL-GROUP-23/backend/database/LSOA_features_with_clusters.csv
# Columns used: lsoa_code, lsoa_name, latitude, longitude, cluster
_CSV_PATH = os.path.join(_BACKEND_DIR, "database", "LSOA_features_with_clusters.csv")

def load_clusters_from_csv(csv_path: str = _CSV_PATH) -> dict:
    """
    Reads the saved K-means CSV and returns:
        {cluster_id: {"centroid": {"lat": float, "lng": float}, "lsoas": [...]}}

    Much faster than re-running K-means on every sim startup.
    """
    import csv

    if not os.path.exists(csv_path):
        raise FileNotFoundError(
            f"Cluster CSV not found at '{csv_path}'.\n"
            f"Run kmeans.py once with the cl.to_csv line uncommented to generate it."
        )

    clusters: dict[int, dict] = {}

    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if not row.get("latitude") or not row.get("longitude") or not row.get("cluster"):
                continue
            cid = int(float(row["cluster"]))
            if cid not in clusters:
                clusters[cid] = {"lats": [], "lngs": [], "lsoas": []}
            clusters[cid]["lats"].append(float(row["latitude"]))
            clusters[cid]["lngs"].append(float(row["longitude"]))
            clusters[cid]["lsoas"].append({
                "lsoa_code": row.get("lsoa_code", ""),
                "lsoa_name": row.get("lsoa_name", ""),
                "latitude":  float(row["latitude"]),
                "longitude": float(row["longitude"]),
                "cluster":   cid,
            })

    if not clusters:
        raise ValueError(f"CSV at '{csv_path}' loaded but contains no valid rows.")

    result = {}
    for cid, data in clusters.items():
        result[cid] = {
            "centroid": {
                "lat": sum(data["lats"]) / len(data["lats"]),
                "lng": sum(data["lngs"]) / len(data["lngs"]),
            },
            "lsoas": data["lsoas"],
        }

    return result

# TSP helper — call the real patrol_routing and extract road_route
def build_patrol_route(police_force: str, start: dict, limit: int = 12) -> list[dict]:
    """
    Calls patrol_routing.run_db_patrol() and returns the road_route polyline
    as a list of {lat, lng} dicts.

    Falls back to a straight-line loop over the patrol waypoints if the
    Google Maps call fails (e.g. no API key in test environment).
    """
    try:
        result = patrol_routing.run_db_patrol(
            police_force=police_force,
            police_station=start,
            limit=limit,
        )
        road_route = result.get("road_route", [])
        if road_route:
            print(f"  [TSP] Real road route: {len(road_route)} points, "
                  f"{result['total_route_time_minutes']:.1f} min estimated.")
            return road_route

        # road_route empty — fall back to master_patrol_loop straight lines
        print("  [TSP] road_route empty, using master_patrol_loop waypoints directly.")
        return result.get("master_patrol_loop", [])

    except Exception as exc:
        print(f"  [TSP] Google Maps call failed ({exc}). "
              f"Officer will orbit cluster centroid instead.")
        return []


class PatrolSimulation:
    def __init__(self, city_key: str):
        cfg = CITY_CONFIGS[city_key]
        self.city_key    = city_key
        self.city_cfg    = cfg
        self.center_lat, self.center_lng = cfg["center"]
        self.police_force = cfg["police_force"]
        self.station      = cfg["station"]

        self.officers: dict[str, Officer] = {}
        self.sio = socketio.AsyncClient()
        self._register_handlers()

    # Socket.IO handlers

    def _register_handlers(self):

        @self.sio.on("dispatch_alert")
        async def on_dispatch_alert(data):
            await self._handle_dispatch_alert(data)

        @self.sio.on("connect")
        async def on_connect():
            print(f"[SIM] Connected to server at {SERVER_URL}")

        @self.sio.on("disconnect")
        async def on_disconnect():
            print("[SIM] Disconnected from server.")

    # Fleet initialisation
    def initialise_fleet(self, clusters: dict):
        """
        Spawn officers, assign each to a cluster, build TSP routes,
        and set initial states.

        clusters: output of parse_kmeans_output()
            {cluster_id: {"centroid": {lat, lng}, "lsoas": [...]}}
        """
        cluster_ids = sorted(clusters.keys())
        n_fixed = max(1, round(NUMBER_OF_OFFICERS * CLUSTER_FIXED_FRACTION))

        for i in range(NUMBER_OF_OFFICERS):
            car_id = f"Car_{101 + i}"
            cid    = cluster_ids[i % len(cluster_ids)]
            centroid = clusters[cid]["centroid"]

            # Spawn officer at their cluster centroid with a small random offset
            lat = centroid["lat"] + random.uniform(-0.005, 0.005)
            lng = centroid["lng"] + random.uniform(-0.005, 0.005)

            state = OfficerState.CLUSTER_FIXED if i < n_fixed else OfficerState.PATROLLING

            officer = Officer(
                car_id=car_id,
                lat=lat,
                lng=lng,
                state=state,
                cluster_id=cid,
                cluster_centroid=centroid,
                orbit_angle=random.uniform(0, 2 * math.pi),
                station_lat=self.station["lat"],
                station_lng=self.station["lng"],
            )

            # Build TSP road route for patrolling officers
            if state == OfficerState.PATROLLING:
                print(f"  Building TSP route for {car_id} ...")
                start_wp = {"lat": lat, "lng": lng, "name": f"{car_id} start"}
                road_route = build_patrol_route(
                    police_force=self.police_force,
                    start=start_wp,
                    limit=12,
                )
                if road_route:
                    officer.patrol_route = road_route
                else:
                    # Google Maps unavailable — fall back to cluster_fixed orbit
                    print(f"  {car_id} has no road route; switching to cluster_fixed.")
                    officer.state = OfficerState.CLUSTER_FIXED

            self.officers[car_id] = officer

        n_patrolling = sum(1 for o in self.officers.values() if o.state == OfficerState.PATROLLING)
        n_fixed_actual = sum(1 for o in self.officers.values() if o.state == OfficerState.CLUSTER_FIXED)
        print(f"\n[SIM] Fleet ready: {n_patrolling} patrolling, {n_fixed_actual} cluster_fixed.")

    # Movement helpers
    
    def _step_toward(self, officer: Officer, target_lat: float, target_lng: float) -> bool:
        """
        Move officer one step toward target. Returns True if arrived.'
        """
        dlat = target_lat - officer.lat
        dlng = target_lng - officer.lng
        dist = math.hypot(dlat, dlng)

        if dist <= MOVEMENT_STEP:
            officer.lat = target_lat
            officer.lng = target_lng
            return True

        officer.lat += MOVEMENT_STEP * (dlat / dist)
        officer.lng += MOVEMENT_STEP * (dlng / dist)
        return False

    def _advance_patrol(self, officer: Officer):
        """Step through the TSP road_route polyline."""
        if not officer.patrol_route:
            return

        target = officer.patrol_route[officer.patrol_index]
        arrived = self._step_toward(officer, float(target["lat"]), float(target["lng"]))

        if arrived:
            officer.patrol_index = (officer.patrol_index + 1) % len(officer.patrol_route)

    def _advance_orbit(self, officer: Officer):
        """Orbit the cluster centroid at a fixed radius."""
        officer.orbit_angle += 0.05
        officer.lat = officer.cluster_centroid["lat"] + CLUSTER_ORBIT_RADIUS * math.sin(officer.orbit_angle)
        officer.lng = officer.cluster_centroid["lng"] + CLUSTER_ORBIT_RADIUS * math.cos(officer.orbit_angle)

    def _advance_response(self, officer: Officer):
        """
        Follow the Reversed Dijkstra road route toward the incident.
        Transitions to at_station on arrival.
        """
        if not officer.response_route:
            # No road route available — move straight-line as fallback
            if officer.incident_lat is None:
                officer.state = OfficerState.PATROLLING
                return
            arrived = self._step_toward(officer, officer.incident_lat, officer.incident_lng)
            if arrived:
                self._arrive_at_incident(officer)
            return

        if officer.response_index >= len(officer.response_route):
            self._arrive_at_incident(officer)
            return

        target = officer.response_route[officer.response_index]
        arrived = self._step_toward(officer, float(target[0]), float(target[1]))

        if arrived:
            officer.response_index += 1
            if officer.response_index >= len(officer.response_route):
                self._arrive_at_incident(officer)

    def _arrive_at_incident(self, officer: Officer):
        print(f"[SIM] {officer.car_id} arrived at incident '{officer.incident_id}'.")
        officer.incident_lat    = None
        officer.incident_lng    = None
        officer.incident_id     = None
        officer.response_route  = []
        officer.response_index  = 0
        officer.state           = OfficerState.AT_STATION
        officer.station_ticks_remaining = AT_STATION_COOLDOWN
        officer.lat = self.station["lat"]
        officer.lng = self.station["lng"]

    def _advance_station(self, officer: Officer):
        """Count down cooldown, then resume patrol."""
        officer.station_ticks_remaining -= 1
        if officer.station_ticks_remaining <= 0:
            print(f"[SIM] {officer.car_id} leaving station, resuming patrol.")
            officer.state         = OfficerState.PATROLLING
            officer.patrol_index  = 0

    # Dispatch handler — calls the real Reversed Dijkstra

    async def _handle_dispatch_alert(self, data: dict):
        """
        On dispatch_alert from server:
        1. Build current available-officer dict from simulation state.
        2. Call reversed_djikstra.find_nearest_officers() for a real traffic route.
        3. Assign the chosen officer and store their road polyline.
        """
        inc_lat = float(data.get("lat", 0))
        inc_lng = float(data.get("lng", 0))
        inc_id  = data.get("incident_id") or data.get("crime_type", "SOS")

        candidates = {
            o.car_id: (o.lat, o.lng)
            for o in self.officers.values()
            if o.state in (OfficerState.PATROLLING, OfficerState.CLUSTER_FIXED)
        }

        if not candidates:
            print(f"[SIM] No available officers for incident '{inc_id}'!")
            return

        print(f"[SIM] Incident '{inc_id}' at ({inc_lat:.4f},{inc_lng:.4f}). "
              f"Calling Reversed Dijkstra with {len(candidates)} candidates ...")

        try:
            if not DIJKSTRA_AVAILABLE:
                raise RuntimeError("reversed_djikstra not loaded (missing API key)")
            assignments = _reversed_djikstra_module.find_nearest_officers(
                no_officers=1,
                officers=candidates,
                dest=(inc_lat, inc_lng),
            )
            assignment  = assignments[0]
            car_id      = assignment["officer_id"]
            road_route  = assignment["route"]   # list of (lat, lng) tuples from polyline.decode
            duration_s  = assignment["traffic_duration_s"]

            print(f"[SIM] Dijkstra assigned {car_id} — ETA {duration_s}s, "
                  f"{len(road_route)} route points.")

        except Exception as exc:
            # Google Maps unavailable — pick nearest officer by straight-line distance
            print(f"[SIM] Reversed Dijkstra failed ({exc}). Falling back to nearest-euclidean.")
            car_id     = min(candidates, key=lambda cid: math.hypot(
                candidates[cid][0] - inc_lat, candidates[cid][1] - inc_lng))
            road_route = []

        officer = self.officers[car_id]
        officer.state          = OfficerState.RESPONDING
        officer.incident_lat   = inc_lat
        officer.incident_lng   = inc_lng
        officer.incident_id    = inc_id
        officer.response_route = road_route   # list of (lat, lng) tuples
        officer.response_index = 0

        print(f"[SIM] {car_id} dispatched to '{inc_id}'.")
        await self._emit_state(officer)

    # Emitters

    async def _emit_location(self, officer: Officer):
        """Emit GPS ping — consumed by main.py's update_location handler."""
        await self.sio.emit("update_location", {
            "car_id": officer.car_id,
            "lat":    round(officer.lat, 6),
            "lng":    round(officer.lng, 6),
        })

    async def _emit_state(self, officer: Officer):
        """
        Emit rich state payload for the dashboard.
        Frontend listens on `officer_state_update`.
        """
        payload = {
            "car_id": officer.car_id,
            "state":  officer.state.value,
            "lat":    round(officer.lat, 6),
            "lng":    round(officer.lng, 6),
        }

        if officer.state == OfficerState.CLUSTER_FIXED:
            payload["cluster_centroid"] = officer.cluster_centroid
            payload["cluster_id"]       = officer.cluster_id

        elif officer.state == OfficerState.PATROLLING:
            payload["cluster_id"]       = officer.cluster_id
            payload["waypoint_index"]   = officer.patrol_index
            payload["total_waypoints"]  = len(officer.patrol_route)

        elif officer.state == OfficerState.RESPONDING:
            payload["incident_id"]      = officer.incident_id
            payload["incident_lat"]     = officer.incident_lat
            payload["incident_lng"]     = officer.incident_lng
            payload["route_progress"]   = officer.response_index
            payload["route_total"]      = len(officer.response_route)

        elif officer.state == OfficerState.AT_STATION:
            payload["cooldown_ticks"]   = officer.station_ticks_remaining

        await self.sio.emit("officer_state_update", payload)

    # Main tick

    async def tick(self):
        for officer in self.officers.values():
            if officer.state == OfficerState.PATROLLING:
                self._advance_patrol(officer)
            elif officer.state == OfficerState.CLUSTER_FIXED:
                self._advance_orbit(officer)
            elif officer.state == OfficerState.RESPONDING:
                self._advance_response(officer)
            elif officer.state == OfficerState.AT_STATION:
                self._advance_station(officer)

            await self._emit_location(officer)
            await self._emit_state(officer)

    # Entry point

    async def run(self):
        print(f"\n[SIM] Loading cluster assignments from CSV ...")
        clusters = load_clusters_from_csv()
        total_lsoas = sum(len(c["lsoas"]) for c in clusters.values())
        print(f"[SIM] Loaded {len(clusters)} clusters, {total_lsoas} LSOAs from CSV.")

        print(f"\n[SIM] Initialising fleet ({NUMBER_OF_OFFICERS} officers) ...")
        self.initialise_fleet(clusters)

        print(f"\n[SIM] Connecting to server at {SERVER_URL} ...")
        await self.sio.connect(SERVER_URL)

        print(f"\n[SIM] Simulation running — {self.city_key.title()}, "
              f"tick every {GPS_TICK_SECONDS}s. Ctrl+C to stop.\n")

        try:
            while True:
                await self.tick()
                await asyncio.sleep(GPS_TICK_SECONDS)
        except asyncio.CancelledError:
            pass
        finally:
            await self.sio.disconnect()
            print("[SIM] Simulation stopped.")


# CLI entry point

if __name__ == "__main__":
    city_input = input(
        "Choose city (birmingham / london / liverpool / leeds): "
    ).strip().lower()

    if city_input not in CITY_CONFIGS:
        print(f"Unknown city '{city_input}'. Options: {', '.join(CITY_CONFIGS)}")
        sys.exit(1)

    sim = PatrolSimulation(city_key=city_input)

    try:
        asyncio.run(sim.run())
    except KeyboardInterrupt:
        print("\n[SIM] Interrupted by user.")
