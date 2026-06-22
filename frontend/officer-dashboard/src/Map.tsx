import { useEffect, useState } from "react";
import {
  GoogleMap,
  LoadScript,
  DirectionsRenderer,
  Marker,
} from "@react-google-maps/api";
import { io } from "socket.io-client";
import "./Map.css";

const socket = io("http://localhost:8000");

const policeStation = {
  lat: 51.5028,
  lng: -0.1242,
};

// interface EmergencyData {
//   lat: number;
//   lng: number;
//   message?: string;
// }

function getInitialOfficerId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("car") || "101";
}

function getInitialPoliceForce() {
  const params = new URLSearchParams(window.location.search);
  return params.get("force") || "Metropolitan Police Service";
}

export default function Map() {
  const [officerId, setOfficerId] = useState<string>(getInitialOfficerId);
  const [officerIdInput, setOfficerIdInput] = useState<string>(officerId);
  const [policeForce] = useState<string>(getInitialPoliceForce);

  const [directions, setDirections] =
    useState<google.maps.DirectionsResult | null>(null);

  const [patrolTime, setPatrolTime] = useState<string | null>(null);
  const [isPatrolling, setIsPatrolling] = useState<boolean>(true);
  const [notification, setNotification] = useState<string | null>(null);

  const [officerLocation, setOfficerLocation] =
    useState<google.maps.LatLngLiteral | null>(null);

  const [crimeLocation, setCrimeLocation] =
    useState<google.maps.LatLngLiteral | null>(null);

  useEffect(() => {
    const carId = `Car ${officerId}`;

    socket.emit("register_officer", {
      officer_id: officerId,
    });

    socket.on("deployment_update", (data: any) => {
      console.log("Deployment received:", data);

      const assignedOfficer = data.assigned_officers?.find(
        (officer: any) => officer.car_id === carId
      );

      if (!assignedOfficer) {
        // this dispatch wasn't for this car — ignore it
        return;
      }

      setIsPatrolling(false);
      setOfficerLocation(assignedOfficer.location);
      setCrimeLocation(data.destination);
      setNotification(`DISPATCHED TO ${data.incident_id}`);
      setTimeout(() => setNotification(null), 8000);
    });

    socket.on("fleet_update", (fleet) => {
      const car = fleet[carId];

      if (car) {
        setOfficerLocation({
          lat: car[0],
          lng: car[1],
        });
      }
    });

    return () => {
      socket.off("deployment_update");
      socket.off("fleet_update");
    };
  }, [officerId]);

  useEffect(() => {
    loadPatrolRoute();
  }, [officerId]);

  useEffect(() => {
    if (!officerLocation || !crimeLocation) return;

    const service = new google.maps.DirectionsService();

    service.route(
      {
        origin: officerLocation,
        destination: crimeLocation,
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === "OK" && result) {
          setDirections(result);
        }
      }
    );
  }, [officerLocation, crimeLocation]);

  const loadPatrolRoute = async () => {
    try {
      const response = await fetch(
        "http://localhost:8000/phase2/generate-route",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            police_force: policeForce,
            start_lat: policeStation.lat,
            start_lng: policeStation.lng,
            start_name: `Officer ${officerId} patrol start`,
            limit: 15,
          }),
        }
      );

      const data = await response.json();

      if (data.status === "success" && data.route_data) {
        setIsPatrolling(true);

        setPatrolTime(
          `${Math.round(
            data.route_data.total_route_time_minutes
          )} mins`
        );

        const patrolNodes = data.route_data.master_patrol_loop;
        const waypoints = patrolNodes.slice(1, -1).map((p: any) => ({
          location: {
            lat: p.lat,
            lng: p.lng,
          },
          stopover: true,
        }));

        const service = new google.maps.DirectionsService();

        service.route(
          {
            origin: policeStation,
            destination: policeStation,
            waypoints,
            optimizeWaypoints: false,
            travelMode: google.maps.TravelMode.DRIVING,
          },
          (result, status) => {
            if (status === "OK" && result) {
              setDirections(result);
            } else {
              console.error("DirectionsService failed to render patrol route:", status);
            }
          }
        );
      } else {
        console.error("Patrol route request did not return a route:", data);
      }
    } catch (error) {
      console.error("Error loading patrol route:", error);
    }
  };

  return (
    <LoadScript
      googleMapsApiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
    >
      <main className="officer-dashboard">

        {notification && (
          <div className="urgent-alert-overlay">
            <div className="urgent-alert-box">
              <h2>Emergency Dispatch</h2>
              <p>{notification}</p>
            </div>
          </div>
        )}

        <header className="topbar">
          <div className="topbar-title">
            <h1>Officer Dashboard</h1>
            <span>Unit {officerId}</span>
          </div>

          <form
            className="officer-id-switcher"
            onSubmit={(event) => {
              event.preventDefault();
              if (officerIdInput.trim()) {
                setOfficerId(officerIdInput.trim());
              }
            }}
          >
            <label htmlFor="officer-id-input" style={{ fontSize: "12px" }}>
              Car #
            </label>
            <input
              id="officer-id-input"
              value={officerIdInput}
              onChange={(event) => setOfficerIdInput(event.target.value)}
              style={{ width: "60px" }}
            />
            <button type="submit" className="secondary-action">
              Switch
            </button>
          </form>

          <div className="dispatcher-user">
            <span>{officerId}</span>

            <div>
              <strong>Officer {officerId}</strong>
              <small>Patrol Unit</small>
            </div>
          </div>
        </header>

        <aside className="floating-panel">
          <div className="panel-heading">
            <span>Patrol Operations</span>
          </div>

          <button
            className="primary-action"
            onClick={loadPatrolRoute}
          >
            Start Routine Patrol
          </button>

          {isPatrolling && patrolTime && (
            <div className="route-summary">
              <p>
                <b>Estimated Patrol:</b> {patrolTime}
              </p>
            </div>
          )}
        </aside>

        <section className="map-shell">
          <GoogleMap
            mapContainerStyle={{
              width: "100%",
              height: "100vh",
            }}
            center={policeStation}
            zoom={12}
          >
            <Marker
              position={policeStation}
              label="HQ"
            />

            {officerLocation && (
              <Marker
                position={officerLocation}
                label={{
                  text: officerId,
                  color: "#ffffff",
                  fontWeight: "900",
                }}
                icon={{
                  path: google.maps.SymbolPath.CIRCLE,
                  fillColor: "#2563eb",
                  fillOpacity: 1,
                  strokeColor: "#ffffff",
                  strokeWeight: 3,
                  scale: 12,
                }}
              />
            )}

            {crimeLocation && (
              <Marker
                position={crimeLocation}
                label={{
                  text: "!",
                  color: "#ffffff",
                  fontWeight: "900",
                }}
                icon={{
                  path: google.maps.SymbolPath.CIRCLE,
                  fillColor: "#dc2626",
                  fillOpacity: 1,
                  strokeColor: "#ffffff",
                  strokeWeight: 3,
                  scale: 14,
                }}
              />
            )}

            {directions && (
              <DirectionsRenderer
                directions={directions}
                options={{
                  polylineOptions: {
                    strokeColor: isPatrolling
                      ? "#0f172a"
                      : "#ef4444",
                    strokeWeight: 5,
                  },
                }}
              />
            )}
          </GoogleMap>

          <div className="map-card map-card-top">
            <strong>Patrol Coverage Area</strong>
          </div>
        </section>
      </main>
    </LoadScript>
  );
}