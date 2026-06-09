import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {io} from "socket.io-client";

const socket = io("http://localhost:8000")

type LayerKey = "clusters" | "patrolRoute" | "officers" | "incidents" | "emergencyRoute";

type FleetUnit = {
  id: string;
  state: string;
  area: string;
  status: "available" | "responding" | "patrolling" | "scene";
  position: { lat: number; lng: number };
};
 
type MapFocusTarget =
  | { type: "car"; id: string; position: { lat: number; lng: number } }
  | { type: "incident"; id: string; position: { lat: number; lng: number } };

type Incident = {
  id: string;
  type: string;
  time: string;
  priority: string;
  status: "pending" | "dispatched";
  position: { lat: number; lng: number };
  address: string;
  source: string;
  reporter: string;
  details: string;
};

type PoliceFeature = {
  type: "Feature";
  geometry: unknown;
  properties: {
    PFA23NM: string;
    LAT?: number;
    LONG?: number;
  };
};

type PoliceFeatureCollection = {
  type: "FeatureCollection";
  features: PoliceFeature[];
};

type LsoaFeature = {
  type: "Feature";
  geometry: unknown;
  properties: {
    LSOA21CD: string;
    LSOA21NM?: string;
    LAT?: number;
    LONG?: number;
  };
};

type LsoaFeatureCollection = {
  type: "FeatureCollection";
  features: LsoaFeature[];
};

type KMeansZone = {
  lsoa_code: string;
  lsoa_name: string;
  latitude: number;
  longitude: number;
  cluster: number;
  monthly_mean_rate_per_1000: number;
  coefficient_of_variation_capped: number;
  violence_share: number;
  asb_share: number;
  shoplifting_share: number;
};

type DeploymentAssignment = {
  car_id: string;
  status: "responding";
  location: { lat: number; lng: number };
  traffic_duration_s: number;
  route: { lat: number; lng: number }[];
};

type DeploymentResponse = {
  status: "success" | "error";
  data?: {
    incident_id: string;
    destination: { lat: number; lng: number };
    assigned_officers: DeploymentAssignment[];
  };
  message?: string;
};

type PatrolRouteNode = {
  lat: number;
  lng: number;
  name: string;
  score?: number;
};

type PatrolRouteResponse = {
  status: "success" | "error";
  route_data?: {
    master_patrol_loop: PatrolRouteNode[];
    road_route?: { lat: number; lng: number }[];
    total_route_time_minutes: number;
  };
  message?: string;
};

declare global {
  interface Window {
    google?: any;
    initDispatcherGoogleMap?: () => void;
  }
}

const excludedPoliceForces = new Set(["Greater Manchester", "British Transport Police"]);
const databasePoliceForceNames: Record<string, string> = {
  "Avon and Somerset": "Avon and Somerset Constabulary",
  "Bedfordshire": "Bedfordshire Police",
  "Cambridgeshire": "Cambridgeshire Constabulary",
  "Cheshire": "Cheshire Constabulary",
  "City of London": "City of London Police",
  "Cleveland": "Cleveland Police",
  "Cumbria": "Cumbria Constabulary",
  "Derbyshire": "Derbyshire Constabulary",
  "Devon and Cornwall": "Devon & Cornwall Police",
  "Dorset": "Dorset Police",
  "Durham": "Durham Constabulary",
  "Dyfed-Powys": "Dyfed-Powys Police",
  "Essex": "Essex Police",
  "Gloucestershire": "Gloucestershire Constabulary",
  "Gwent": "Gwent Police",
  "Hampshire and Isle of Wight": "Hampshire Constabulary",
  "Hertfordshire": "Hertfordshire Constabulary",
  "Humberside": "Humberside Police",
  "Kent": "Kent Police",
  "Lancashire": "Lancashire Constabulary",
  "Leicestershire": "Leicestershire Police",
  "Lincolnshire": "Lincolnshire Police",
  "Merseyside": "Merseyside Police",
  "Metropolitan Police": "Metropolitan Police Service",
  "Norfolk": "Norfolk Constabulary",
  "North Wales": "North Wales Police",
  "North Yorkshire": "North Yorkshire Police",
  "Northamptonshire": "Northamptonshire Police",
  "Northumbria": "Northumbria Police",
  "Nottinghamshire": "Nottinghamshire Police",
  "South Wales": "South Wales Police",
  "South Yorkshire": "South Yorkshire Police",
  "Staffordshire": "Staffordshire Police",
  "Suffolk": "Suffolk Constabulary",
  "Surrey": "Surrey Police",
  "Sussex": "Sussex Police",
  "Thames Valley": "Thames Valley Police",
  "Warwickshire": "Warwickshire Police",
  "West Mercia": "West Mercia Police",
  "West Midlands": "West Midlands Police",
  "West Yorkshire": "West Yorkshire Police",
  "Wiltshire": "Wiltshire Police",
};

const initialLayers: Record<LayerKey, boolean> = {
  clusters: true,
  patrolRoute: false,
  officers: true,
  incidents: true,
  emergencyRoute: false,
};

const initialFleet: FleetUnit[] = [
  {
    id: "Car 101",
    state: "State 1: Available",
    area: "Central",
    status: "available",
    position: { lat: 52.4862, lng: -1.8904 },
  },
  {
    id: "Car 102",
    state: "State 3: Responding",
    area: "East sector",
    status: "responding",
    position: { lat: 52.505, lng: -1.835 },
  },
  {
    id: "Car 103",
    state: "State 2: Patrolling",
    area: "North ring",
    status: "patrolling",
    position: { lat: 52.528, lng: -1.918 },
  },
  {
    id: "Car 104",
    state: "State 4: At scene",
    area: "High street",
    status: "scene",
    position: { lat: 52.471, lng: -1.872 },
  },
  {
    id: "Car 105",
    state: "State 2: Patrolling",
    area: "West sector",
    status: "patrolling",
    position: { lat: 52.464, lng: -1.946 },
  },
];

const initialIncidents: Incident[] = [
  {
    id: "INC-2401",
    type: "Violence or threat",
    time: "14:42",
    priority: "High",
    status: "pending",
    position: { lat: 52.49, lng: -1.884 },
    address: "Not provided",
    source: "simulated_device_location",
    reporter: "Verified reporter #0241",
    details: "Witness reports shouting near the junction",
  },
  {
    id: "INC-2399",
    type: "Vehicle crime",
    time: "14:19",
    priority: "Medium",
    status: "pending",
    position: { lat: 52.512, lng: -1.902 },
    address: "New Street station, Station St, Birmingham B2 4QA, UK",
    source: "google_address_search",
    reporter: "Verified reporter #0241",
    details: "No details provided",
  },
  {
    id: "INC-2396",
    type: "Anti-social behaviour",
    time: "13:57",
    priority: "Low",
    status: "pending",
    position: { lat: 52.475, lng: -1.914 },
    address: "Not provided",
    source: "simulated_device_location",
    reporter: "Verified reporter #0241",
    details: "Group blocking the entrance",
  },
];

const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const apiUrl = (import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:8000";
const apiCandidates = Array.from(
  new Set([
    apiUrl.replace(/\/$/, ""),
    apiUrl.includes("localhost")
      ? apiUrl.replace("localhost", "127.0.0.1").replace(/\/$/, "")
      : apiUrl.replace("127.0.0.1", "localhost").replace(/\/$/, ""),
  ]),
);
const clusterNames: Record<number, string> = {
  0: "Low-demand, volatile",
  1: "High-demand / shoplifting areas",
  2: "Medium-demand / violence-dominant areas",
  3: "Medium-high / ASB-heavy demand",
};

const clusterColors: Record<number, string> = {
  0: "#4A90A4",
  1: "#D64550",
  2: "#F29E4C",
  3: "#F2C94C",
};

function App() {
  const [policeForces, setPoliceForces] = useState<string[]>([]);
  const [selectedForce, setSelectedForce] = useState("");
  const [forceSearch, setForceSearch] = useState("");
  const [layers, setLayers] = useState(initialLayers);
  const [showEmergency, setShowEmergency] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [officersRequired, setOfficersRequired] = useState(2);
  const [kMeansZones, setKMeansZones] = useState<KMeansZone[]>([]);
  const [visibleClusters, setVisibleClusters] = useState<number[]>(Object.keys(clusterNames).map(Number));
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>(initialIncidents);
  const [fleet, setFleet] = useState<FleetUnit[]>(initialFleet);
  const [sidebarWidth, setSidebarWidth] = useState(430);
  const [reportsHeight, setReportsHeight] = useState(360);
  const [deploymentRoutes, setDeploymentRoutes] = useState<{ carId: string; route: { lat: number; lng: number }[] }[]>([]);
  const [patrolRoute, setPatrolRoute] = useState<PatrolRouteNode[]>([]);
  const [patrolRoadRoute, setPatrolRoadRoute] = useState<{ lat: number; lng: number }[]>([]);
  const [patrolRouteMinutes, setPatrolRouteMinutes] = useState<number | null>(null);
  const [isPatrolRouteGenerated, setIsPatrolRouteGenerated] = useState(false);
  const [isPatrolRouteLoading, setIsPatrolRouteLoading] = useState(false);
  const [patrolRouteError, setPatrolRouteError] = useState("");
  const [dispatchError, setDispatchError] = useState("");
  const [isDispatching, setIsDispatching] = useState(false);
  const [mapFocusTarget, setMapFocusTarget] = useState<MapFocusTarget | null>(null);
  const [incomingAlert, setIncomingAlert] = useState<Incident | null>(null);

  const activeIncident = selectedIncident || incidents[0];
  const filteredPoliceForces = policeForces.filter((force) =>
    force.toLowerCase().includes(forceSearch.toLowerCase()),
  );

  useEffect(() => {
    Promise.all([
      fetch("/data/police_force_areas.geojson").then((response) => response.json()),
      fetch("/data/lsoa_features_with_clusters.csv").then((response) => response.text()),
    ])
      .then(([geoJson, csvText]: [PoliceFeatureCollection, string]) => {
        const forceNames = Array.from(
          new Set(
            geoJson.features
              .map((feature) => feature.properties.PFA23NM)
              .filter((name) => name && !excludedPoliceForces.has(name)),
          ),
        ).sort();

        const zones = parseClusterCsv(csvText);

        setPoliceForces(forceNames);
        setSelectedForce((current) => current || forceNames[0] || "");
        setForceSearch((current) => current || forceNames[0] || "");
        setKMeansZones(zones);
      })
      .catch(() => {
        setPoliceForces([]);
      });
  }, []);

  useEffect(() => {
    // Listen for Live Citizen SOS Emergencies
    socket.on("dispatch_alert", (data: any) => {
      console.log("Real-time Citizen SOS alert received!", data);
      
      // Generate a new dynamic incident card for the dashboard
      const dynamicIncident: Incident = {
        id: `INC-${Math.floor(1000 + Math.random() * 9000)}`,
        type: data.crime_type || "Citizen SOS Emergency",
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        priority: "High",
        status: "pending",
        position: { lat: data.lat, lng: data.lng },
        address: "Live GPS Tracking Location",
        source: "citizen_app_sos",
        reporter: "Mobile User",
        details: data.details,
      };

      // Push it to the top of the dispatcher's incoming reports list
      setIncidents((prevIncidents) => [dynamicIncident, ...prevIncidents]);

      // Trigger the flashing pop-up
      setIncomingAlert(dynamicIncident);
    });

    // Listen for Live GPS Fleet Location Updates
    socket.on("fleet_update", (serverFleet: Record<string, [number, number]>) => {
      console.log("Received fleet GPS tracking matrix:", serverFleet);
      
      // Map the backend dictionary data format into the frontend state structures
      setFleet((currentFleet) =>
        currentFleet.map((car) => {
          const backendKey = car.id.replace(" ", "_"); 
          if (serverFleet[backendKey]) {
            const [lat, lng] = serverFleet[backendKey];
            return {
              ...car,
              position: { lat, lng },
            };
          }
          return car;
        })
      );
    });

    return () => {
      socket.off("dispatch_alert");
      socket.off("fleet_update");
    };
  }, []);

  function toggleLayer(layer: LayerKey) {
    setLayers((current) => ({
      ...current,
      [layer]: !current[layer],
    }));
  }

  async function showPatrolRoutes() {
    const startCar = fleet.find((car) => car.status === "available" || car.status === "patrolling") || fleet[0];
    const databaseForceName = databasePoliceForceNames[selectedForce] || selectedForce;

    if (!selectedForce || !startCar) {
      setPatrolRouteError("Select a police force and make sure at least one car is active.");
      return;
    }

    setIsPatrolRouteLoading(true);
    setPatrolRouteError("");

    try {
      let response: Response | null = null;
      let fetchError: unknown = null;

      for (const candidateUrl of apiCandidates) {
        try {
          response = await fetch(`${candidateUrl}/phase2/generate-route`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              police_force: databaseForceName,
              start_lat: startCar.position.lat,
              start_lng: startCar.position.lng,
              start_name: `${startCar.id} current position`,
              limit: 15,
            }),
          });
          break;
        } catch (error) {
          fetchError = error;
        }
      }

      if (!response) {
        throw fetchError instanceof Error ? fetchError : new Error("Patrol route server is not reachable");
      }

      const result = (await response.json()) as PatrolRouteResponse;

      if (!response.ok || result.status !== "success" || !result.route_data) {
        throw new Error(result.message || "Patrol route request failed");
      }

      setPatrolRoute(
        result.route_data.master_patrol_loop.map((node) => ({
          lat: Number(node.lat),
          lng: Number(node.lng),
          name: node.name,
          score: node.score,
        })),
      );
      setPatrolRoadRoute(
        (result.route_data.road_route || result.route_data.master_patrol_loop).map((point) => ({
          lat: Number(point.lat),
          lng: Number(point.lng),
        })),
      );
      setPatrolRouteMinutes(result.route_data.total_route_time_minutes);
      setIsPatrolRouteGenerated(true);
      setLayers((current) => ({ ...current, patrolRoute: true }));
    } catch (error) {
      setPatrolRoute([]);
      setPatrolRoadRoute([]);
      setPatrolRouteMinutes(null);
      setIsPatrolRouteGenerated(false);
      setPatrolRouteError(error instanceof Error ? error.message : "Patrol route request failed");
    } finally {
      setIsPatrolRouteLoading(false);
    }
  }

  function toggleCluster(cluster: number) {
    setVisibleClusters((current) =>
      current.includes(cluster)
        ? current.filter((visibleCluster) => visibleCluster !== cluster)
        : [...current, cluster].sort(),
    );
  }

  function openDispatch(incident: Incident) {
    setSelectedIncident(incident);
    setOfficersRequired(2);
    setShowEmergency(true);
  }

  async function dispatchOfficers() {
    if (!activeIncident) {
      return;
    }

    setIsDispatching(true);
    setDispatchError("");

    try {
      const response = await fetch(`${apiUrl}/phase3/deploy-officers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          incident_id: activeIncident.id,
          lat: activeIncident.position.lat,
          lng: activeIncident.position.lng,
          officers_needed: officersRequired,
        }),
      });

      const result = (await response.json()) as DeploymentResponse;

      if (!response.ok || result.status !== "success" || !result.data) {
        throw new Error(result.message || "Deployment request failed");
      }

      const assignedIds = new Set(result.data.assigned_officers.map((officer) => officer.car_id));

      setFleet((currentFleet) =>
        currentFleet.map((car) =>
          assignedIds.has(car.id)
            ? { ...car, state: "State 3: Responding", status: "responding" }
            : car,
        ),
      );
      setDeploymentRoutes(
        result.data.assigned_officers.map((officer) => ({
          carId: officer.car_id,
          route: officer.route,
        })),
      );
    } catch (error) {
      setDispatchError(error instanceof Error ? error.message : "Deployment request failed");
      setIsDispatching(false);
      return;
    }

    setIncidents((currentIncidents) =>
      currentIncidents.map((incident) =>
        incident.id === activeIncident.id ? { ...incident, status: "dispatched" } : incident,
      ),
    );
    setSelectedIncident((currentIncident) =>
      currentIncident?.id === activeIncident.id
        ? { ...currentIncident, status: "dispatched" }
        : currentIncident,
    );
    setLayers((current) => ({ ...current, officers: true, emergencyRoute: true }));
    setIsDispatching(false);
    setShowEmergency(false);
  }

  function startHorizontalResize(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = sidebarWidth;

    function onMouseMove(moveEvent: MouseEvent) {
      const nextWidth = startWidth - (moveEvent.clientX - startX);
      setSidebarWidth(Math.min(680, Math.max(340, nextWidth)));
    }

    function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  function startVerticalResize(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();

    const startY = event.clientY;
    const startHeight = reportsHeight;

    function onMouseMove(moveEvent: MouseEvent) {
      const nextHeight = startHeight + (moveEvent.clientY - startY);
      const maxHeight = Math.max(240, window.innerHeight - 320);
      setReportsHeight(Math.min(maxHeight, Math.max(180, nextHeight)));
    }

    function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  return (
    <>
      {/* flashing alert */}
      {incomingAlert && (
        <div className="urgent-alert-overlay">
          <div className="urgent-alert-box">
            <h2>Urgent: SOS Received</h2>
            <p><strong>Type:</strong> {incomingAlert.type}</p>
            <p><strong>Details:</strong> {incomingAlert.details}</p>
            
            <div className="urgent-alert-actions">
              <button 
                className="secondary-action" 
                onClick={() => setIncomingAlert(null)}
              >
                Dismiss
              </button>
              <button 
                className="danger-action" 
                onClick={() => {
                  setIncomingAlert(null); // Close the flash
                  openDispatch(incomingAlert); // Open the dispatch menu
                }}
              >
                Dispatch Cars
              </button>
            </div>
          </div>
        </div>
      )}

      {/* main dashboard grid*/}
      <main
        className="dashboard"
        style={{ gridTemplateColumns: `minmax(420px, 1fr) 10px ${sidebarWidth}px` }}
      >
        <section className="map-workspace">
          <header className="topbar">
            <div className="topbar-title">
              <h1>Dispatcher Dashboard</h1>
            </div>

            <div className="force-picker">
              <input
                id="force-search"
                list="police-force-options"
                value={forceSearch}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setForceSearch(nextValue);

                  if (policeForces.includes(nextValue)) {
                    setSelectedForce(nextValue);
                  }
                }}
                placeholder="Search police force"
                disabled={policeForces.length === 0}
              />
              <datalist id="police-force-options">
                {filteredPoliceForces.map((force) => (
                  <option key={force} value={force}>
                    {force}
                  </option>
                ))}
              </datalist>
            </div>

            <div className="dispatcher-user">
              <span>DS</span>
              <div>
                <strong>Dispatcher Smith</strong>
                <small>Control Room</small>
              </div>
            </div>
          </header>

          <section className="map-shell" aria-label="Dispatcher Google Map">
            <DispatcherMap
              apiKey={googleMapsApiKey}
              selectedForce={selectedForce}
              layers={layers}
              fleet={fleet}
              incidents={incidents}
              kMeansZones={kMeansZones}
              visibleClusters={visibleClusters}
              deploymentRoutes={deploymentRoutes}
              patrolRoute={patrolRoute}
              patrolRoadRoute={patrolRoadRoute}
              isPatrolRouteGenerated={isPatrolRouteGenerated}
              focusTarget={mapFocusTarget}
            />

            <div className="map-card map-card-top">
              <strong>Selected force boundary</strong>
            </div>

            {layers.clusters && kMeansZones.length > 0 && (
              <div className="cluster-legend">
                <strong>Daily zones</strong>
                {Object.entries(clusterNames).map(([cluster, name]) => (
                  <label className="legend-row" key={cluster}>
                    <input
                      type="checkbox"
                      checked={visibleClusters.includes(Number(cluster))}
                      onChange={() => toggleCluster(Number(cluster))}
                    />
                    <span
                      className="legend-swatch"
                      style={{ background: clusterColor(Number(cluster)) }}
                    ></span>
                    <span>{name}</span>
                  </label>
                ))}
              </div>
            )}
          </section>
        </section>

        <div
          className="splitter splitter-horizontal"
          role="separator"
          aria-orientation="vertical"
          onMouseDown={startHorizontalResize}
        ></div>

        <aside className="sidebar">
          <section className="panel reports-panel" style={{ height: reportsHeight }}>
            <div className="panel-heading">
              <span>Incoming Reports</span>
            </div>
            <div className="incoming-reports">
              {incidents.map((incident) => (
                <article className="report-card" key={incident.id}>
                  <header className="report-header">
                    <strong>{incident.id}</strong>
                    <span className={incident.status}>{incident.status}</span>
                  </header>
                  <div className="report-summary">
                    <p><b>{incident.type}</b></p>
                    <p>{incident.time} · {incident.priority} priority</p>
                    <p>{incident.address}</p>
                  </div>
                  <div className="report-actions">
                    <button
                      className="secondary-action small-action"
                      onClick={() => {
                        setSelectedIncident(incident);
                        setShowDetails(true);
                      }}
                    >
                      View details
                    </button>
                    <button
                      className="primary-action small-action"
                      onClick={() => openDispatch(incident)}
                    >
                      Dispatch
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <div
            className="splitter splitter-vertical"
            role="separator"
            aria-orientation="horizontal"
            onMouseDown={startVerticalResize}
          ></div>

          <section className="panel compact-panel">
            <div className="panel-heading">
              <span>Daily Patrol Route</span>
            </div>
            <div className="control-grid">
              <button className="secondary-action small-action" onClick={showPatrolRoutes} disabled={isPatrolRouteLoading}>
                {isPatrolRouteLoading ? "Generating..." : "Generate Patrol Route"}
              </button>
            </div>
            <div className="route-summary">
              <p>
                <b>Estimated loop:</b>{" "}
                {patrolRouteMinutes ? `${Math.round(patrolRouteMinutes)} min` : "Not generated"}
              </p>
              <p>
                <b>Route status:</b>{" "}
                {isPatrolRouteLoading ? "Checking live traffic" : isPatrolRouteGenerated ? "Ready for review" : "Waiting for dispatcher"}
              </p>
              {patrolRoute.length > 0 && (
                <p>
                  <b>Stops:</b> {Math.max(patrolRoute.length - 2, 0)} hotspots
                </p>
              )}
              {patrolRouteError && <p className="dispatch-error">{patrolRouteError}</p>}
            </div>
          </section>

          <section className="panel compact-panel">
            <div className="panel-heading">
              <span>Map Layers</span>
            </div>
            <div className="filters">
              {Object.entries(layers).map(([key, enabled]) => (
                <label key={key} className="check-row">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => toggleLayer(key as LayerKey)}
                  />
                  <span>{layerLabel(key as LayerKey)}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="panel feed-panel">
            <div className="panel-heading">
              <span>Fleet Status</span>
              <small>{fleet.length} active units</small>
            </div>
            <div className="fleet-feed">
              {fleet.map((car) => (
                <button
                  className="fleet-card"
                  key={car.id}
                  onClick={() => setMapFocusTarget({ type: "car", id: car.id, position: car.position })}
                >
                  <div>
                    <strong>{car.id}</strong>
                    <p>{car.area}</p>
                  </div>
                  <span className={`fleet-pill ${car.status}`}>{car.state}</span>
                </button>
              ))}
            </div>
          </section>
        </aside>

        {showEmergency && activeIncident && (
          <section className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="emergency-modal">
              <div className="modal-map">
                <DispatcherMap
                  apiKey={googleMapsApiKey}
                  selectedForce={selectedForce}
                  layers={{
                    clusters: false,
                    patrolRoute: false,
                    officers: true,
                    incidents: true,
                    emergencyRoute: true,
                  }}
                  fleet={fleet}
                  incidents={[activeIncident]}
                  kMeansZones={[]}
                  visibleClusters={visibleClusters}
                  deploymentRoutes={deploymentRoutes}
                  patrolRoute={patrolRoute}
                  patrolRoadRoute={patrolRoadRoute}
                  isPatrolRouteGenerated={isPatrolRouteGenerated}
                  focusTarget={mapFocusTarget}
                  compact
                />
              </div>
              <div className="modal-content">
                <p className="alert-label">Incoming SOS</p>
                <h2>Dispatch officers</h2>
                <p className="modal-copy">
                  Choose how many cars to send to {activeIncident.id}.
                </p>

                <label className="field-label" htmlFor="officers-required">
                  Number of cars required
                </label>
                <input
                  id="officers-required"
                  min={1}
                  max={fleet.length}
                  type="number"
                  value={officersRequired}
                  onChange={(event) => setOfficersRequired(Number(event.target.value))}
                />
                {dispatchError && <p className="modal-error">{dispatchError}</p>}

                <div className="modal-actions">
                  <button className="secondary-action" onClick={() => setShowEmergency(false)}>
                    Review later
                  </button>
                  <button className="danger-action" disabled={isDispatching} onClick={dispatchOfficers}>
                    {isDispatching ? "Dispatching..." : "Send cars"}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {showDetails && selectedIncident && (
          <section className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="details-modal">
              <header className="report-header">
                <strong>{selectedIncident.id}</strong>
                <span className={selectedIncident.status}>{selectedIncident.status}</span>
              </header>
              <div className="report-fields">
                <p><b>Crime type:</b> {selectedIncident.type.toLowerCase()}</p>
                <p><b>Latitude:</b> {selectedIncident.position.lat.toFixed(6)}</p>
                <p><b>Longitude:</b> {selectedIncident.position.lng.toFixed(6)}</p>
                <p><b>Address:</b> {selectedIncident.address}</p>
                <p><b>Time:</b> {selectedIncident.time}</p>
                <p><b>Location source:</b> {selectedIncident.source}</p>
                <p><b>Reporter:</b> {selectedIncident.reporter}</p>
                <p><b>Details:</b> {selectedIncident.details}</p>
              </div>
              <div className="modal-actions">
                <button className="secondary-action" onClick={() => setShowDetails(false)}>
                  Close
                </button>
                <button
                  className="danger-action"
                  onClick={() => {
                    setShowDetails(false);
                    openDispatch(selectedIncident);
                  }}
                >
                  Dispatch
                </button>
              </div>
            </div>
          </section>
        )}
      </main>
    </>
  );
}

function DispatcherMap({
  apiKey,
  selectedForce,
  layers,
  fleet,
  incidents,
  kMeansZones,
  visibleClusters,
  deploymentRoutes,
  patrolRoute,
  patrolRoadRoute,
  isPatrolRouteGenerated,
  focusTarget,
  compact = false,
}: {
  apiKey?: string;
  selectedForce: string;
  layers: Record<LayerKey, boolean>;
  fleet: FleetUnit[];
  incidents: Incident[];
  kMeansZones: KMeansZone[];
  visibleClusters: number[];
  deploymentRoutes: { carId: string; route: { lat: number; lng: number }[] }[];
  patrolRoute: PatrolRouteNode[];
  patrolRoadRoute: { lat: number; lng: number }[];
  isPatrolRouteGenerated: boolean;
  focusTarget: MapFocusTarget | null;
  compact?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const dataLayerRef = useRef<any>(null);
  const clusterLayerRef = useRef<any>(null);
  const markerRefs = useRef<any[]>([]);
  const lineRefs = useRef<any[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [policeGeoJson, setPoliceGeoJson] = useState<PoliceFeatureCollection | null>(null);
  const [lsoaGeoJson, setLsoaGeoJson] = useState<LsoaFeatureCollection | null>(null);

  const center = useMemo(() => incidents[0]?.position ?? { lat: 52.4862, lng: -1.8904 }, [incidents]);

  useEffect(() => {
    if (!apiKey) {
      setLoadError("Add VITE_GOOGLE_MAPS_API_KEY to dispatcher-dashboard/.env");
      return;
    }

    loadGoogleMaps(apiKey)
      .then(() => setIsReady(true))
      .catch(() => setLoadError("Google Maps could not be loaded"));
  }, [apiKey]);

  useEffect(() => {
    if (!isReady || !containerRef.current || !window.google) {
      return;
    }

    if (!mapRef.current) {
      mapRef.current = new window.google.maps.Map(containerRef.current, {
        center,
        zoom: compact ? 12 : 10,
        disableDefaultUI: compact,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        styles: mapStyles,
      });
    }
  }, [center, compact, isReady]);

  useEffect(() => {
    if (!isReady)
      return;

    Promise.all([
      fetch("/data/police_force_areas.geojson").then((res) => res.json()),
      fetch("/data/LSOA_boundaries.geojson").then((res) => res.json()),
    ])
      .then(([policeData, lsoaData]) => {
        setPoliceGeoJson(policeData);
        setLsoaGeoJson(lsoaData);
      })
      .catch(() => setLoadError("Failed to load map boundary data"));
  }, [isReady]);

  useEffect(() => {
    if (!isReady || !mapRef.current || !window.google || !policeGeoJson) {
      return;
    }

    if (dataLayerRef.current) {
      dataLayerRef.current.setMap(null);
    }

    const selectedFeature = policeGeoJson.features.find(
      (feature) => feature.properties.PFA23NM === selectedForce,
    );

    const featureCollection: PoliceFeatureCollection = {
      type: "FeatureCollection",
      features: selectedFeature ? [selectedFeature] : [],
    };

    const dataLayer = new window.google.maps.Data({ map: mapRef.current });
    dataLayer.addGeoJson(featureCollection);
    dataLayer.setStyle({
      fillColor: "#2563eb",
      fillOpacity: 0,
      strokeColor: "#2563eb",
      strokeOpacity: 0.95,
      strokeWeight: 3,
    });

    dataLayerRef.current = dataLayer;

    if (selectedFeature) {
      const bounds = getFeatureBounds(selectedFeature);
      if (bounds) {
        mapRef.current.fitBounds(bounds, compact ? 38 : 64);
      }
    }
  }, [compact, isReady, selectedForce, policeGeoJson]);


  useEffect(() => {
    if (!isReady || !mapRef.current || !window.google || !focusTarget) {
      return;
    }

    mapRef.current.panTo(focusTarget.position);
    mapRef.current.setZoom(focusTarget.type === "incident" ? 15 : 16);
  }, [focusTarget, isReady]);

  useEffect(() => {
    if (!isReady || !mapRef.current || !window.google || !policeGeoJson || !lsoaGeoJson) {
      return;
    }

    if (clusterLayerRef.current) {
      clusterLayerRef.current.setMap(null);
      clusterLayerRef.current = null;
    }

    if (!layers.clusters || kMeansZones.length === 0) {
      return;
    }

    const zoneByLsoa = new Map(kMeansZones.map((zone) => [zone.lsoa_code, zone]));

    const selectedPoliceFeature = policeGeoJson.features.find(
      (feature) => feature.properties.PFA23NM === selectedForce,
    );

    const clusteredFeatures = lsoaGeoJson.features.filter((feature) => {
      const zone = zoneByLsoa.get(feature.properties.LSOA21CD);

      if (!zone || !selectedPoliceFeature || !visibleClusters.includes(zone.cluster)) {
        return false;
      }

      return pointInFeature(
        Number(feature.properties.LAT),
        Number(feature.properties.LONG),
        selectedPoliceFeature,
      );
    });

    const dataLayer = new window.google.maps.Data({ map: mapRef.current });
    dataLayer.addGeoJson({
      type: "FeatureCollection",
      features: clusteredFeatures,
    });
    
    dataLayer.setStyle((feature: any) => {
      const lsoaCode = feature.getProperty("LSOA21CD");
      const zone = zoneByLsoa.get(lsoaCode);
      const cluster = zone?.cluster ?? 0;

      return {
        fillColor: clusterColor(cluster),
        fillOpacity: 0.3,
        strokeColor: clusterColor(cluster),
        strokeOpacity: 0.85,
        strokeWeight: 1,
      };
    });

    const infoWindow = new window.google.maps.InfoWindow();
    dataLayer.addListener("click", (event: any) => {
      const lsoaCode = event.feature.getProperty("LSOA21CD");
      const boundaryName = event.feature.getProperty("LSOA21NM");
      const zone = zoneByLsoa.get(lsoaCode);

      if (!zone) {
        return;
      }

      infoWindow.setContent(lsoaInfoHtml(zone, boundaryName));
      infoWindow.setPosition(event.latLng);
      infoWindow.open(mapRef.current);
    });

    clusterLayerRef.current = dataLayer;
    
  }, [isReady, kMeansZones, layers.clusters, selectedForce, visibleClusters, policeGeoJson, lsoaGeoJson]);

  useEffect(() => {
    if (!isReady || !mapRef.current || !window.google) {
      return;
    }

    markerRefs.current.forEach((marker) => marker.setMap(null));
    lineRefs.current.forEach((line) => line.setMap(null));
    markerRefs.current = [];
    lineRefs.current = [];

    if (layers.officers) {
      fleet.forEach((car) => {
        markerRefs.current.push(
          new window.google.maps.Marker({
            map: mapRef.current,
            position: car.position,
            title: `${car.id} - ${car.state}`,
            label: {
              text: car.id.replace("Car ", ""),
              color: "#ffffff",
              fontSize: "11px",
              fontWeight: "900",
            },
            icon: circleIcon(car.status),
          }),
        );
      });
    }

    if (layers.incidents) {
      incidents.forEach((incident) => {
        markerRefs.current.push(
          createIncidentMarker({
            map: mapRef.current,
            incident,
            onClick: () => {
              mapRef.current.panTo(incident.position);
              mapRef.current.setZoom(15);
            },
          }),
        );
      });
    }

    if (layers.patrolRoute && isPatrolRouteGenerated && patrolRoute.length > 1) {
      lineRefs.current.push(
        new window.google.maps.Polyline({
          map: mapRef.current,
          path: patrolRoadRoute.length > 1 ? patrolRoadRoute : patrolRoute,
          strokeColor: "#0f172a",
          strokeOpacity: 0.82,
          strokeWeight: 5,
        }),
      );

      patrolRoute.slice(1, -1).forEach((stop, index) => {
        markerRefs.current.push(
          new window.google.maps.Marker({
            map: mapRef.current,
            position: stop,
            title: `${index + 1}. ${stop.name}${stop.score ? ` - score ${Math.round(stop.score)}` : ""}`,
            label: {
              text: String(index + 1),
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: "900",
            },
            icon: circleSymbol("#0f172a", 13),
            zIndex: 20,
          }),
        );
      });
    }

    if (layers.emergencyRoute && deploymentRoutes.length > 0) {
        deploymentRoutes.forEach((deploymentRoute) => {
          lineRefs.current.push(
            new window.google.maps.Polyline({
              map: mapRef.current,
              path: deploymentRoute.route,
              strokeColor: "#ef4444",
              strokeOpacity: 0.95,
              strokeWeight: 5,
            }),
          );
        });
    }
  }, [deploymentRoutes, fleet, incidents, isPatrolRouteGenerated, isReady, layers, patrolRoadRoute, patrolRoute]);

  return (
    <>
      <div className="google-map" ref={containerRef}></div>
      {loadError && <div className="map-error">{loadError}</div>}
    </>
  );
}

function loadGoogleMaps(apiKey: string) {
  if (window.google?.maps) {
    return Promise.resolve();
  }

  const existingScript = document.querySelector<HTMLScriptElement>(
    'script[data-dispatcher-google-maps="true"]',
  );

  if (existingScript) {
    return new Promise<void>((resolve, reject) => {
      existingScript.addEventListener("load", () => resolve());
      existingScript.addEventListener("error", () => reject());
    });
  }

  return new Promise<void>((resolve, reject) => {
    window.initDispatcherGoogleMap = () => resolve();

    const script = document.createElement("script");
    script.dataset.dispatcherGoogleMaps = "true";
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=initDispatcherGoogleMap`;
    script.onerror = () => reject();
    document.head.appendChild(script);
  });
}

function getFeatureBounds(feature: PoliceFeature) {
  if (!window.google) {
    return null;
  }

  const bounds = new window.google.maps.LatLngBounds();
  const geometry = feature.geometry as any;

  walkCoordinates(geometry.coordinates, (lng, lat) => {
    bounds.extend({ lat, lng });
  });

  return bounds;
}

function walkCoordinates(value: any, visit: (lng: number, lat: number) => void) {
  if (!Array.isArray(value)) {
    return;
  }

  if (typeof value[0] === "number" && typeof value[1] === "number") {
    visit(value[0], value[1]);
    return;
  }

  value.forEach((item) => walkCoordinates(item, visit));
}

function parseClusterCsv(csvText: string) {
  const [headerLine, ...rows] = csvText.trim().split(/\r?\n/);
  const headers = headerLine.split(",");
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));

  return rows
    .map((row) => {
      const cells = row.split(",");

      return {
        lsoa_code: cells[index.lsoa_code],
        lsoa_name: cells[index.lsoa_name],
        latitude: Number(cells[index.latitude]),
        longitude: Number(cells[index.longitude]),
        cluster: Number(cells[index.cluster]),
        monthly_mean_rate_per_1000: Number(cells[index.monthly_mean_rate_per_1000]),
        coefficient_of_variation_capped: Number(cells[index.coefficient_of_variation_capped]),
        violence_share: Number(cells[index.violence_share]),
        asb_share: Number(cells[index.asb_share]),
        shoplifting_share: Number(cells[index.shoplifting_share]),
      };
    })
    .filter((zone) => zone.lsoa_code && Number.isFinite(zone.cluster));
}

function lsoaInfoHtml(zone: KMeansZone, boundaryName: string) {
  return `
    <div class="lsoa-popup">
      <strong>${escapeHtml(boundaryName || zone.lsoa_name)}</strong>
      <p><b>LSOA code:</b> ${escapeHtml(zone.lsoa_code)}</p>
      <p><b>Cluster:</b> ${escapeHtml(clusterNames[zone.cluster] || `Cluster ${zone.cluster}`)}</p>
      <p><b>Monthly rate / 1000:</b> ${formatNumber(zone.monthly_mean_rate_per_1000)}</p>
    </div>
  `;
}

function escapeHtml(value: string) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "N/A";
}

function pointInFeature(lat: number, lng: number, feature: PoliceFeature) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false;
  }

  const geometry = feature.geometry as any;

  if (geometry.type === "Polygon") {
    return pointInPolygon(lng, lat, geometry.coordinates);
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon: number[][][]) => pointInPolygon(lng, lat, polygon));
  }

  return false;
}

function pointInPolygon(lng: number, lat: number, polygon: number[][][]) {
  const outerRing = polygon[0];
  let isInside = false;

  for (let current = 0, previous = outerRing.length - 1; current < outerRing.length; previous = current++) {
    const currentLng = outerRing[current][0];
    const currentLat = outerRing[current][1];
    const previousLng = outerRing[previous][0];
    const previousLat = outerRing[previous][1];

    const intersects =
      currentLat > lat !== previousLat > lat &&
      lng < ((previousLng - currentLng) * (lat - currentLat)) / (previousLat - currentLat) + currentLng;

    if (intersects) {
      isInside = !isInside;
    }
  }

  return isInside;
}

function circleIcon(status: FleetUnit["status"]) {
  const colorByStatus: Record<FleetUnit["status"], string> = {
    available: "#2563eb",
    responding: "#f97316",
    patrolling: "#0891b2",
    scene: "#16a34a",
  };

  return circleSymbol(colorByStatus[status], 12);
}

function createIncidentMarker({
  map,
  incident,
  onClick,
}: {
  map: any;
  incident: Incident;
  onClick: () => void;
}) {
  const marker = new window.google.maps.Marker({
    map,
    position: incident.position,
    title: `${incident.id} - ${incident.type}`,
    label: {
      text: "!",
      color: "#ffffff",
      fontSize: "18px",
      fontWeight: "900",
    },
    icon: circleSymbol("#dc2626", 14),
  });

  marker.addListener("click", onClick);

  return marker;
}

function circleSymbol(color: string, scale: number) {
  return {
    path: window.google.maps.SymbolPath.CIRCLE,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: 3,
    scale,
  };
}

function clusterColor(cluster: number) {
  return clusterColors[cluster] || "#E5E7EB";
}

function layerLabel(layer: LayerKey) {
  const labels: Record<LayerKey, string> = {
    clusters: "Clusters",
    patrolRoute: "Daily patrol route",
    officers: "Officers",
    incidents: "Incidents",
    emergencyRoute: "Emergency route",
  };

  return labels[layer];
}

const mapStyles = [
  {
    featureType: "poi",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "transit",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#ffffff" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#bfdbfe" }],
  },
  {
    featureType: "landscape",
    elementType: "geometry",
    stylers: [{ color: "#eef6ff" }],
  },
];

export default App;
