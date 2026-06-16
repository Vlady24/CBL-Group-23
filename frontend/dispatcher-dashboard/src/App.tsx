import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {io} from "socket.io-client";

const socket = io("http://localhost:8000")

const FLEET_SIMULATION_INTERVAL_MS = 3000;
const EMERGENCY_ROUTE_POINTS_PER_TICK = 3;
const PATROL_ROUTE_POINTS_PER_TICK = 2;
const PATROL_HOTSPOT_DWELL_TICKS = 10;
const MIN_SIMULATED_CARS = 1;
const MAX_SIMULATED_CARS = 30;

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
  policeForce: string;
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

type DeploymentRoute = {
  incidentId: string;
  carId: string;
  route: { lat: number; lng: number }[];
};

type RouteProgress = {
  route: { lat: number; lng: number }[];
  index: number;
  dwellTicksRemaining?: number;
};

type FleetStatusUpdate = Record<
  string,
  {
    lat: number;
    lng: number;
    status: FleetUnit["status"];
  }
>;

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

const initialIncidents: Incident[] = [];

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

const fleetStateLabels: Record<FleetUnit["status"], string> = {
  available: "State 1: Available",
  patrolling: "State 2: Patrolling",
  responding: "State 3: Responding",
  scene: "State 4: At scene",
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
  const [allIncidents, setAllIncidents] = useState<Incident[]>(initialIncidents);
  const [sceneIncidents, setSceneIncidents] = useState<Incident[]>([]);
  const [fleet, setFleet] = useState<FleetUnit[]>(initialFleet);
  const [fleetSimulationSize, setFleetSimulationSize] = useState(initialFleet.length);
  const [sidebarWidth, setSidebarWidth] = useState(430);
  const [reportsHeight, setReportsHeight] = useState(360);
  const [deploymentRoutes, setDeploymentRoutes] = useState<DeploymentRoute[]>([]);
  const [patrolRoute, setPatrolRoute] = useState<PatrolRouteNode[]>([]);
  const [patrolRoadRoute, setPatrolRoadRoute] = useState<{ lat: number; lng: number }[]>([]);
  const [patrolRouteMinutes, setPatrolRouteMinutes] = useState<number | null>(null);
  const [isPatrolRouteGenerated, setIsPatrolRouteGenerated] = useState(false);
  const [isPatrolRouteLoading, setIsPatrolRouteLoading] = useState(false);
  const [patrolRouteError, setPatrolRouteError] = useState("");
  const [dispatchError, setDispatchError] = useState("");
  const [isDispatching, setIsDispatching] = useState(false);
  const [mapFocusTarget, setMapFocusTarget] = useState<MapFocusTarget | null>(null);
  const [newReportNoticeId, setNewReportNoticeId] = useState<string | null>(null);
  const [policeGeoJson, setPoliceGeoJson] = useState<PoliceFeatureCollection | null>(null);
  const [showPatrolAssignMenu, setShowPatrolAssignMenu] = useState(false);
  const [patrolAssignOfficerId, setPatrolAssignOfficerId] = useState("");
  const fleetRef = useRef<FleetUnit[]>(initialFleet);
  const emergencyRouteProgressRef = useRef<Record<string, RouteProgress>>({});
  const patrolRouteProgressRef = useRef<Record<string, RouteProgress>>({});
  const pendingPatrolRouteRequestsRef = useRef<Set<string>>(new Set());
  const policeGeoJsonRef = useRef<PoliceFeatureCollection | null>(null);
  const selectedForceRef = useRef("");

  const incidents = useMemo(
    () => allIncidents.filter((incident) => !selectedForce || incident.policeForce === selectedForce),
    [allIncidents, selectedForce],
  );
  const mapIncidents = useMemo(
    () => [
      ...incidents,
      ...sceneIncidents.filter((incident) => !selectedForce || incident.policeForce === selectedForce),
    ],
    [incidents, sceneIncidents, selectedForce],
  );
  const activeIncident = selectedIncident || incidents[0];
  const dispatchableFleet = fleet.filter((car) => car.status === "available" || car.status === "patrolling");
  const maxDispatchableCars = dispatchableFleet.length;
  const newReportNotice = incidents.find(
    (incident) => incident.id === newReportNoticeId && incident.status === "pending",
  );
  const filteredPoliceForces = policeForces.filter((force) =>
    force.toLowerCase().includes(forceSearch.toLowerCase()),
  );

  useEffect(() => {
    policeGeoJsonRef.current = policeGeoJson;
  }, [policeGeoJson]);

  useEffect(() => {
    selectedForceRef.current = selectedForce;
  }, [selectedForce]);

  useEffect(() => {
    fleetRef.current = fleet;
  }, [fleet]);

  useEffect(() => {
    setSelectedIncident((currentIncident) => {
      if (!currentIncident || !selectedForce || currentIncident.policeForce === selectedForce) {
        return currentIncident;
      }

      setShowDetails(false);
      setShowEmergency(false);
      return null;
    });

    const latestPendingIncident = incidents.find((incident) => incident.status === "pending");
    setNewReportNoticeId((currentNoticeId) => {
      const currentNoticeStillVisible = incidents.some(
        (incident) => incident.id === currentNoticeId && incident.status === "pending",
      );

      return currentNoticeStillVisible ? currentNoticeId : latestPendingIncident?.id || null;
    });
  }, [incidents, selectedForce]);

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

        setPoliceGeoJson(geoJson);
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
    // get live citizen incident reports 
    socket.on("dispatch_alert", (data: any) => {
      console.log("Real-time Citizen SOS alert received!", data);

      const reportForce = findPoliceForceForPoint(
        Number(data.lat),
        Number(data.lng),
        policeGeoJsonRef.current,
      );
      if (!reportForce) {
        console.log("Ignoring citizen SOS because it could not be matched to a police force boundary.");
        return;
      }
      
      // create a new incident card in the "Incidents" tab 
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
        policeForce: reportForce,
      };

      // Store every report received, but only display the ones within the current Police Force boundary 
      setAllIncidents((prevIncidents) => [dynamicIncident, ...prevIncidents]);
      if (reportForce === selectedForceRef.current) {
        setNewReportNoticeId(dynamicIncident.id);
      }
    });

    // Live gps fleet loc updates
    socket.on("fleet_update", (serverFleet: Record<string, [number, number]>) => {
      console.log("Received fleet GPS tracking matrix:", serverFleet);
      
      setFleet((currentFleet) =>
        currentFleet.map((car) => {
          const backendKey = car.id.replace(" ", "_"); 
          const serverLocation = serverFleet[car.id] || serverFleet[backendKey];
          if (serverLocation) {
            const [lat, lng] = serverLocation;
            return {
              ...car,
              position: { lat, lng },
            };
          }
          return car;
        })
      );
    });

    socket.on("fleet_status_update", (serverFleet: FleetStatusUpdate) => {
      console.log("Received fleet status update:", serverFleet);

      setFleet((currentFleet) =>
        currentFleet.map((car) => {
          const backendKey = car.id.replace(" ", "_");
          const serverCar = serverFleet[car.id] || serverFleet[backendKey];

          if (!serverCar) {
            return car;
          }

          return {
            ...car,
            state: fleetStateLabels[serverCar.status],
            status: serverCar.status,
            position: {
              lat: serverCar.lat,
              lng: serverCar.lng,
            },
          };
        })
      );
    });

    return () => {
      socket.off("dispatch_alert");
      socket.off("fleet_update");
      socket.off("fleet_status_update");
    };
  }, []);

  useEffect(() => {
    if (!selectedForce || !policeGeoJson) {
      return;
    }

    const selectedFeature = policeGeoJson.features.find(
      (feature) => feature.properties.PFA23NM === selectedForce,
    );

    if (!selectedFeature) {
      return;
    }

    const { fleet: repositionedFleet, sceneIncidents: nextSceneIncidents } = createFleetSimulation(
      fleetRef.current.length,
      selectedForce,
      selectedFeature,
      kMeansZones,
      fleetRef.current.map((car) => car.status),
    );

    fleetRef.current = repositionedFleet;
    setFleet(repositionedFleet);
    setSceneIncidents(nextSceneIncidents);
    replaceFleetOnServer(repositionedFleet);

    patrolRouteProgressRef.current = {};
    pendingPatrolRouteRequestsRef.current.clear();
    emergencyRouteProgressRef.current = {};
    setDeploymentRoutes([]);

    const intervalId = window.setInterval(() => {
      const nextFleet: FleetUnit[] = fleetRef.current.map((car) => {
        if (car.status === "responding") {
          const routeProgress = emergencyRouteProgressRef.current[car.id];

          if (!routeProgress || routeProgress.route.length === 0) {
            return car;
          }

          const nextIndex = Math.min(
            routeProgress.index + EMERGENCY_ROUTE_POINTS_PER_TICK,
            routeProgress.route.length - 1,
          );
          const nextPosition = routeProgress.route[nextIndex];

          emergencyRouteProgressRef.current[car.id] = {
            ...routeProgress,
            index: nextIndex,
          };

          if (nextIndex >= routeProgress.route.length - 1) {
            delete emergencyRouteProgressRef.current[car.id];
            return {
              ...car,
              state: fleetStateLabels.scene,
              status: "scene",
              position: nextPosition,
            };
          }

          return {
            ...car,
            position: nextPosition,
          };
        }

        if (car.status === "scene") {
          return car;
        }

        if (car.status === "available") {
          return car;
        }

        if (car.status === "patrolling") {
          const routeProgress = patrolRouteProgressRef.current[car.id];

         
          if (!routeProgress || routeProgress.route.length === 0) {
            return car; 
          }

          if ((routeProgress.dwellTicksRemaining || 0) > 0) {
            patrolRouteProgressRef.current[car.id] = {
              ...routeProgress,
              dwellTicksRemaining: (routeProgress.dwellTicksRemaining || 0) - 1,
            };
            return car;
          }

          if (routeProgress.route.length < 2) {
            delete patrolRouteProgressRef.current[car.id];
            return car; // Leave it alone if the route runs out
          }

          const nextIndex = Math.min(
            routeProgress.index + PATROL_ROUTE_POINTS_PER_TICK,
            routeProgress.route.length - 1,
          );
          const nextPosition = routeProgress.route[nextIndex];

          if (nextIndex >= routeProgress.route.length - 1) {
            patrolRouteProgressRef.current[car.id] = {
              route: [nextPosition],
              index: 0,
              dwellTicksRemaining: PATROL_HOTSPOT_DWELL_TICKS,
            };
          } else {
            patrolRouteProgressRef.current[car.id] = {
              ...routeProgress,
              index: nextIndex,
            };
          }

          return {
            ...car,
            position: nextPosition,
          };
        }

        return car;
      });

      fleetRef.current = nextFleet;
      setFleet(nextFleet);
      // emitFleetLocations(nextFleet);
    }, FLEET_SIMULATION_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [kMeansZones, policeGeoJson, selectedForce]);

  function generateFleetSimulation() {
    if (!selectedForce || !policeGeoJson) {
      return;
    }

    const selectedFeature = policeGeoJson.features.find(
      (feature) => feature.properties.PFA23NM === selectedForce,
    );

    if (!selectedFeature) {
      return;
    }

    const { fleet: nextFleet, sceneIncidents: nextSceneIncidents } = createFleetSimulation(
      fleetSimulationSize,
      selectedForce,
      selectedFeature,
      kMeansZones,
    );

    fleetRef.current = nextFleet;
    patrolRouteProgressRef.current = {};
    pendingPatrolRouteRequestsRef.current.clear();
    emergencyRouteProgressRef.current = {};
    setDeploymentRoutes([]);
    setFleet(nextFleet);
    setSceneIncidents(nextSceneIncidents);
    replaceFleetOnServer(nextFleet);
  }

  function toggleLayer(layer: LayerKey) {
    setLayers((current) => ({
      ...current,
      [layer]: !current[layer],
    }));
  }

  async function generateAndAssignPatrolRoute() {
    const searchId = patrolAssignOfficerId.trim().toLowerCase().replace("car ", "");
    const startCar = fleet.find((car) => car.id.toLowerCase().includes(searchId));
    const databaseForceName = databasePoliceForceNames[selectedForce] || selectedForce;

    if (!selectedForce || !startCar) {
      setPatrolRouteError(`Officer ID "${patrolAssignOfficerId || "empty"}" not found in the active fleet.`);
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

      const masterLoop = result.route_data.master_patrol_loop;
      const roadRoute = result.route_data.road_route && result.route_data.road_route.length > 0
        ? result.route_data.road_route : masterLoop;

      setPatrolRoute(
        masterLoop.map((node) => ({
          lat: Number(node.lat),
          lng: Number(node.lng),
          name: node.name,
          score: node.score,
        })),
      );
      setPatrolRoadRoute(
        roadRoute.map((point) => ({
          lat: Number(point.lat),
          lng: Number(point.lng),
        })),
      );
      setPatrolRouteMinutes(result.route_data.total_route_time_minutes);
      setIsPatrolRouteGenerated(true);
      setLayers((current) => ({ ...current, patrolRoute: true }));

      socket.emit("assign_patrol_route", {
        car_id : startCar.id,
        route : roadRoute
      });

      setShowPatrolAssignMenu(false);
      setPatrolAssignOfficerId("");

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
    setOfficersRequired(Math.min(2, Math.max(1, maxDispatchableCars)));
    setShowEmergency(true);
  }

  function reviewIncident(incident: Incident) {
    setSelectedIncident(incident);
    setMapFocusTarget({ type: "incident", id: incident.id, position: incident.position });
    setShowDetails(true);
  }

  function removeIncident(incidentId: string) {
    setAllIncidents((currentIncidents) => currentIncidents.filter((incident) => incident.id !== incidentId));
    setDeploymentRoutes((currentRoutes) =>
      currentRoutes.filter((route) => route.incidentId !== incidentId),
    );
    setNewReportNoticeId((currentNoticeId) => (currentNoticeId === incidentId ? null : currentNoticeId));
    setSelectedIncident((currentIncident) => {
      if (currentIncident?.id !== incidentId) {
        return currentIncident;
      }

      setShowDetails(false);
      setShowEmergency(false);
      return null;
    });
  }

  async function dispatchOfficers() {
    if (!activeIncident) {
      return;
    }

    if (maxDispatchableCars === 0) {
      setDispatchError("No available or patrolling cars can be dispatched.");
      return;
    }

    if (officersRequired > maxDispatchableCars) {
      setDispatchError(
        `Only ${maxDispatchableCars} available or patrolling car${maxDispatchableCars === 1 ? "" : "s"} can be dispatched.`,
      );
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
          active_car_ids: fleetRef.current.map((car) => car.id),
        }),
      });

      const result = (await response.json()) as DeploymentResponse;

      if (!response.ok || result.status !== "success" || !result.data) {
        throw new Error(result.message || "Deployment request failed");
      }

      const currentCarIds = new Set(fleetRef.current.map((car) => car.id));
      const assignedOfficers = result.data.assigned_officers.filter((officer) =>
        currentCarIds.has(officer.car_id),
      );

      if (assignedOfficers.length === 0) {
        throw new Error("Deployment returned no cars from the current fleet.");
      }

      if (assignedOfficers.length < officersRequired) {
        throw new Error(
          `Only ${assignedOfficers.length} current fleet car${assignedOfficers.length === 1 ? "" : "s"} could be assigned.`,
        );
      }

      const assignedIds = new Set(assignedOfficers.map((officer) => officer.car_id));
      const assignedRoutes = Object.fromEntries(
        assignedOfficers.map((officer) => [officer.car_id, officer.route]),
      );

      assignedOfficers.forEach((officer) => {
        emergencyRouteProgressRef.current[officer.car_id] = {
          route: officer.route,
          index: 0,
        };
      });

      const nextFleet: FleetUnit[] = fleetRef.current.map((car) =>
        assignedIds.has(car.id)
          ? {
              ...car,
              state: fleetStateLabels.responding,
              status: "responding",
              position: assignedRoutes[car.id]?.[0] || car.position,
            }
          : car,
      );
      fleetRef.current = nextFleet;
      setFleet(nextFleet);
      emitFleetLocations(nextFleet);
      setDeploymentRoutes((currentRoutes) => [
        ...currentRoutes.filter((route) => route.incidentId !== activeIncident.id),
        ...assignedOfficers.map((officer) => ({
          incidentId: activeIncident.id,
          carId: officer.car_id,
          route: officer.route,
        })),
      ]);
    } catch (error) {
      setDispatchError(error instanceof Error ? error.message : "Deployment request failed");
      setIsDispatching(false);
      return;
    }

    setAllIncidents((currentIncidents) =>
      currentIncidents.map((incident) =>
        incident.id === activeIncident.id ? { ...incident, status: "dispatched" } : incident,
      ),
    );
    setSelectedIncident((currentIncident) =>
      currentIncident?.id === activeIncident.id
        ? { ...currentIncident, status: "dispatched" }
        : currentIncident,
    );
    setNewReportNoticeId((currentNoticeId) =>
      currentNoticeId === activeIncident.id ? null : currentNoticeId,
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
      {newReportNotice && (
        <div className="urgent-alert-overlay" role="status" aria-live="assertive">
          <div className="urgent-alert-box">
            <h2>Urgent: SOS Received</h2>
            <p><strong>ID:</strong> {newReportNotice.id}</p>
            <p><strong>Type:</strong> {newReportNotice.type}</p>
            <p><strong>Time:</strong> {newReportNotice.time}</p>
            <p><strong>Details:</strong> {newReportNotice.details}</p>

            <div className="urgent-alert-actions">
              <button
                className="secondary-action"
                type="button"
                onClick={() => setNewReportNoticeId(null)}
              >
                Dismiss
              </button>
              <button
                className="danger-action"
                type="button"
                onClick={() => {
                  setNewReportNoticeId(null);
                  openDispatch(newReportNotice);
                }}
              >
                Dispatch Cars
              </button>
            </div>
          </div>
        </div>
      )}

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
            incidents={mapIncidents}
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
            {incidents.length === 0 ? (
              <div className="empty-reports">No crime reports received.</div>
            ) : (
              incidents.map((incident) => (
                <article className="report-card" key={incident.id}>
                  {incident.status === "dispatched" && (
                    <button
                      className="remove-report"
                      type="button"
                      aria-label={`Remove ${incident.id}`}
                      onClick={() => removeIncident(incident.id)}
                    >
                      x
                    </button>
                  )}
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
                      onClick={() => reviewIncident(incident)}
                    >
                      View details
                    </button>
                    <button
                      className="primary-action small-action"
                      disabled={incident.status === "dispatched"}
                      onClick={() => openDispatch(incident)}
                    >
                      Dispatch
                    </button>
                  </div>
                </article>
              ))
            )}
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
              <button className="secondary-action small-action" onClick={() => setShowPatrolAssignMenu(true)} disabled={isPatrolRouteLoading}>
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
          <div className="fleet-simulation-controls">
            <label className="mini-label" htmlFor="fleet-simulation-size">
              Cars in simulation
            </label>
            <div className="fleet-simulation-row">
              <input
                id="fleet-simulation-size"
                min={MIN_SIMULATED_CARS}
                max={MAX_SIMULATED_CARS}
                type="number"
                value={fleetSimulationSize}
                onChange={(event) => {
                  const requestedCars = Number(event.target.value);
                  const cappedCars = Math.min(
                    Math.max(MIN_SIMULATED_CARS, requestedCars || MIN_SIMULATED_CARS),
                    MAX_SIMULATED_CARS,
                  );
                  setFleetSimulationSize(cappedCars);
                }}
              />
              <button className="secondary-action" type="button" onClick={generateFleetSimulation}>
                Generate
              </button>
            </div>
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

      {showEmergency && (
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
              <p className="dispatch-capacity">
                {maxDispatchableCars} available or patrolling car{maxDispatchableCars === 1 ? "" : "s"} can be dispatched.
              </p>

              <label className="field-label" htmlFor="officers-required">
                Number of cars required
              </label>
              <input
                id="officers-required"
                min={1}
                max={Math.max(1, maxDispatchableCars)}
                type="number"
                value={officersRequired}
                onChange={(event) => {
                  const requestedCars = Number(event.target.value);
                  const cappedCars = Math.min(Math.max(1, requestedCars), Math.max(1, maxDispatchableCars));
                  setOfficersRequired(cappedCars);
                }}
              />
              {dispatchError && <p className="modal-error">{dispatchError}</p>}

              <div className="modal-actions">
                <button className="secondary-action" onClick={() => setShowEmergency(false)}>
                  Review later
                </button>
                <button className="danger-action" disabled={isDispatching || maxDispatchableCars === 0} onClick={dispatchOfficers}>
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
              <p><b>Police force:</b> {selectedIncident.policeForce}</p>
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

      {showPatrolAssignMenu && (
          <section className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="details-modal" style={{ maxWidth: "400px" }}>
              <header className="report-header">
                <strong>Assign Patrol Route</strong>
              </header>
              <div className="modal-content" style={{ padding: "0", marginTop: "15px" }}>
                <label className="field-label" htmlFor="patrol-officer-id" style={{ marginTop: 0 }}>
                  Enter Officer ID (e.g., 101)
                </label>
                <input
                  id="patrol-officer-id"
                  type="text"
                  placeholder="101"
                  value={patrolAssignOfficerId}
                  onChange={(e) => setPatrolAssignOfficerId(e.target.value)}
                />
                
                {patrolRouteError && <p className="modal-error">{patrolRouteError}</p>}
                
                <div className="modal-actions" style={{ marginTop: "20px" }}>
                  <button className="secondary-action" onClick={() => {
                    setShowPatrolAssignMenu(false);
                    setPatrolRouteError("");
                  }}>
                    Cancel
                  </button>
                  <button className="primary-action" disabled={isPatrolRouteLoading} onClick={generateAndAssignPatrolRoute}>
                    {isPatrolRouteLoading ? "Generating..." : "Send"}
                  </button>
                </div>
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
  deploymentRoutes: DeploymentRoute[];
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
  const carMarkerRefs = useRef<Record<string, any>>({});
  const incidentMarkerRefs = useRef<Record<string, any>>({});
  const routeMarkerRefs = useRef<any[]>([]);
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

    routeMarkerRefs.current.forEach((marker) => marker.setMap(null));
    lineRefs.current.forEach((line) => line.setMap(null));
    routeMarkerRefs.current = [];
    lineRefs.current = [];

    const currentCarIds = new Set(fleet.map((car) => car.id));
    Object.entries(carMarkerRefs.current).forEach(([carId, marker]) => {
      if (!layers.officers || !currentCarIds.has(carId)) {
        marker.setMap(null);
        delete carMarkerRefs.current[carId];
      }
    });

    if (layers.officers) {
      fleet.forEach((car) => {
        const existingMarker = carMarkerRefs.current[car.id];

        if (existingMarker) {
          existingMarker.setPosition(displayPositionForCar(car));
          existingMarker.setTitle(`${car.id} - ${car.state}`);
          existingMarker.setIcon(circleIcon(car.status));
          existingMarker.setMap(mapRef.current);
          return;
        }

        carMarkerRefs.current[car.id] = new window.google.maps.Marker({
            map: mapRef.current,
            position: displayPositionForCar(car),
            title: `${car.id} - ${car.state}`,
            label: {
              text: car.id.replace("Car ", ""),
              color: "#ffffff",
              fontSize: "11px",
              fontWeight: "900",
            },
            icon: circleIcon(car.status),
          });
      });
    }

    const currentIncidentIds = new Set(incidents.map((incident) => incident.id));
    Object.entries(incidentMarkerRefs.current).forEach(([incidentId, marker]) => {
      if (!layers.incidents || !currentIncidentIds.has(incidentId)) {
        marker.setMap(null);
        delete incidentMarkerRefs.current[incidentId];
      }
    });

    if (layers.incidents) {
      incidents.forEach((incident) => {
        const existingMarker = incidentMarkerRefs.current[incident.id];

        if (existingMarker) {
          existingMarker.setPosition(incident.position);
          existingMarker.setTitle(`${incident.id} - ${incident.type}`);
          existingMarker.setMap(mapRef.current);
          return;
        }

        incidentMarkerRefs.current[incident.id] = createIncidentMarker({
            map: mapRef.current,
            incident,
            onClick: () => {
              mapRef.current.panTo(incident.position);
              mapRef.current.setZoom(15);
            },
          });
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
        routeMarkerRefs.current.push(
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

function findPoliceForceForPoint(lat: number, lng: number, policeGeoJson: PoliceFeatureCollection | null) {
  if (!policeGeoJson) {
    return "";
  }

  const matchingFeature = policeGeoJson.features.find((feature) =>
    pointInFeature(lat, lng, feature),
  );

  return matchingFeature?.properties.PFA23NM || "";
}

// Central police station locations matching simulate_cars_2.py configurations
const regionalPoliceStations: Record<string, { lat: number; lng: number }> = {
  "West Midlands": { lat: 52.4831, lng: -1.8966 },
  "Metropolitan Police": { lat: 51.5074, lng: -0.1278 },
  "Merseyside": { lat: 53.4084, lng: -2.9916 },
  "West Yorkshire": { lat: 53.8008, lng: -1.5491 },
};

function createFleetSimulation(
  carCount: number,
  selectedForce: string,
  selectedFeature: PoliceFeature,
  kMeansZones: KMeansZone[],
  preferredStatuses: FleetUnit["status"][] = [],
) {
  const normalizedCount = Math.min(
    Math.max(MIN_SIMULATED_CARS, Math.floor(carCount) || MIN_SIMULATED_CARS),
    MAX_SIMULATED_CARS,
  );
  const fleet: FleetUnit[] = [];
  const sceneIncidents: Incident[] = [];
  const sceneGroups: { id: string; position: { lat: number; lng: number }; capacity: number; assigned: number }[] = [];

  for (let index = 0; index < normalizedCount; index += 1) {
    const id = `Car ${101 + index}`;
    const preferredStatus = preferredStatuses[index];
    const status = preferredStatus && preferredStatus !== "responding"
      ? preferredStatus
      : randomSimulationStatus();
    let position;
    if (status == "patrolling") {
      position = choosePatrolHotspot(selectedFeature, kMeansZones);
    } else if (status == "available") {
      // find the specific station for the selected force region
      const station = regionalPoliceStations[selectedForce] || {
        lat : Number(selectedFeature.properties.LAT) || 52.4862,
        lng : Number(selectedFeature.properties.LONG) || -1.8904,
      };
      // offset such that the cars do not stack on the map
      position = {
        lat : station.lat + (Math.random() - 0.5) * 0.0004,
        lng : station.lng + (Math.random() - 0.5) * 0.0004,
      };
    } else {
      position = randomPointInFeature(selectedFeature);
    }

    if (status === "scene") {
      let sceneGroup = sceneGroups.find((group) => group.assigned < group.capacity);

      if (!sceneGroup || Math.random() < 0.35) {
        const scenePosition = randomPointInFeature(selectedFeature);
        const sceneId = `SIM-SCENE-${sceneGroups.length + 1}`;
        sceneGroup = {
          id: sceneId,
          position: scenePosition,
          capacity: 2 + Math.floor(Math.random() * 2),
          assigned: 0,
        };
        sceneGroups.push(sceneGroup);
        sceneIncidents.push({
          id: sceneId,
          type: "Simulated active incident",
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          priority: "High",
          status: "dispatched",
          position: scenePosition,
          address: selectedForce,
          source: "fleet_simulation",
          reporter: "Simulation",
          details: "Generated so at-scene units have a visible incident marker.",
          policeForce: selectedForce,
        });
      }

      sceneGroup.assigned += 1;
      position = sceneGroup.position;
    }

    fleet.push({
      id,
      state: fleetStateLabels[status],
      area: selectedForce,
      status,
      position,
    });
  }

  return { fleet, sceneIncidents };
}

function randomSimulationStatus(): FleetUnit["status"] {
  const roll = Math.random();

  if (roll < 0.32) {
    return "available";
  }

  if (roll < 0.78) {
    return "patrolling";
  }

  return "scene";
}

function choosePatrolHotspot(selectedFeature: PoliceFeature, kMeansZones: KMeansZone[]) {
  const hotspots = kMeansZones.filter((zone) =>
    Number.isFinite(zone.latitude) &&
    Number.isFinite(zone.longitude) &&
    [1, 2].includes(zone.cluster) &&
    pointInFeature(zone.latitude, zone.longitude, selectedFeature),
  );

  if (hotspots.length === 0) {
    return randomPointInFeature(selectedFeature);
  }

  const redHotspots = hotspots.filter((zone) => zone.cluster === 1);
  const orangeHotspots = hotspots.filter((zone) => zone.cluster === 2);
  const useRed = redHotspots.length > 0 && (orangeHotspots.length === 0 || Math.random() < 0.75);
  const candidates = useRed ? redHotspots : orangeHotspots;
  const selected = candidates[Math.floor(Math.random() * candidates.length)];

  return jitterPointInsideFeature(
    { lat: selected.latitude, lng: selected.longitude },
    selectedFeature,
  );
}

function jitterPointInsideFeature(point: { lat: number; lng: number }, selectedFeature: PoliceFeature) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const jittered = {
      lat: point.lat + (Math.random() - 0.5) * 0.002,
      lng: point.lng + (Math.random() - 0.5) * 0.002,
    };

    if (pointInFeature(jittered.lat, jittered.lng, selectedFeature)) {
      return jittered;
    }
  }

  return point;
}

function emitFleetLocations(fleet: FleetUnit[]) {
  fleet.forEach((car) => {
    socket.emit("update_location", {
      car_id: car.id,
      lat: car.position.lat,
      lng: car.position.lng,
      status: car.status,
    });
  });
}

function replaceFleetOnServer(fleet: FleetUnit[]) {
  socket.emit("replace_fleet", {
    fleet: fleet.map((car) => ({
      car_id: car.id,
      lat: car.position.lat,
      lng: car.position.lng,
      status: car.status,
    })),
  });
}

function requestPatrolRouteForCar(
  car: FleetUnit,
  selectedFeature: PoliceFeature,
  kMeansZones: KMeansZone[],
  patrolRouteProgressRef: React.MutableRefObject<Record<string, RouteProgress>>,
  pendingRequestsRef: React.MutableRefObject<Set<string>>,
) {
  if (pendingRequestsRef.current.has(car.id) || !window.google?.maps) {
    return;
  }

  pendingRequestsRef.current.add(car.id);
  const service = new window.google.maps.DirectionsService();
  const destination = choosePatrolHotspot(selectedFeature, kMeansZones);

  service.route(
    {
      origin: car.position,
      destination,
      travelMode: window.google.maps.TravelMode.DRIVING,
    },
    (result: any, status: string) => {
      pendingRequestsRef.current.delete(car.id);

      if (status !== "OK" || !result?.routes?.[0]?.overview_path?.length) {
        return;
      }

      patrolRouteProgressRef.current[car.id] = {
        route: result.routes[0].overview_path.map((point: any) => ({
          lat: point.lat(),
          lng: point.lng(),
        })),
        index: 0,
      };
    },
  );
}

function featureBounds(feature: PoliceFeature) {
  const lngValues: number[] = [];
  const latValues: number[] = [];
  const geometry = feature.geometry as any;

  walkCoordinates(geometry.coordinates, (lng, lat) => {
    lngValues.push(lng);
    latValues.push(lat);
  });

  return {
    minLng: Math.min(...lngValues),
    minLat: Math.min(...latValues),
    maxLng: Math.max(...lngValues),
    maxLat: Math.max(...latValues),
  };
}

function randomPointInFeature(feature: PoliceFeature) {
  const bounds = featureBounds(feature);

  for (let attempt = 0; attempt < 10000; attempt += 1) {
    const lat = bounds.minLat + Math.random() * (bounds.maxLat - bounds.minLat);
    const lng = bounds.minLng + Math.random() * (bounds.maxLng - bounds.minLng);

    if (pointInFeature(lat, lng, feature)) {
      return { lat, lng };
    }
  }

  return {
    lat: Number(feature.properties.LAT) || 52.4862,
    lng: Number(feature.properties.LONG) || -1.8904,
  };
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

function displayPositionForCar(car: FleetUnit) {
  if (car.status !== "scene") {
    return car.position;
  }

  const carNumber = Number(car.id.replace(/\D/g, "")) || 0;
  const angle = ((carNumber % 8) / 8) * Math.PI * 2;
  const offset = 0.00055 + (carNumber % 3) * 0.00008;

  return {
    lat: car.position.lat + Math.sin(angle) * offset,
    lng: car.position.lng + Math.cos(angle) * offset,
  };
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
