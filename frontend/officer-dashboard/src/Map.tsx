import { useEffect, useState } from "react";
import {
  GoogleMap,
  LoadScript,
  DirectionsRenderer,
  Marker,
} from "@react-google-maps/api";
import { io } from "socket.io-client";

const socket = io("http://localhost:8000");

const policeStation = {
  lat: 52.4831,
  lng: -1.8966,
};

interface EmergencyData {
  lat: number;
  lng: number;
  message?: string;
}

export default function Map() {
  const [directions, setDirections] =
    useState<google.maps.DirectionsResult | null>(null);

  const [patrolTime, setPatrolTime] = useState<string | null>(null);
  const [isPatrolling, setIsPatrolling] = useState<boolean>(false);
  const [notification, setNotification] = useState<string | null>(null);

  const [officerLocation, setOfficerLocation] =
    useState<google.maps.LatLngLiteral | null>(null);

  const [crimeLocation, setCrimeLocation] =
    useState<google.maps.LatLngLiteral | null>(null);

  useEffect(() => {
    socket.emit("register_officer", {
      officer_id: "101",
    });

    socket.on("dispatch_alert", (data: EmergencyData) => {
      console.log("SOS Received:", data);

      setCrimeLocation({ lat: data.lat, lng: data.lng });
    });

    socket.on("deployment_update", (data: any) => {
      console.log("Deployment received:", data);

      setIsPatrolling(false);

      const assignedOfficer = data.assigned_officers?.[0];
      if (assignedOfficer) {
        setOfficerLocation(assignedOfficer.location);
      }
      setCrimeLocation(data.destination);
      setNotification(`DISPATCHED TO ${data.incident_id}`);
      setTimeout(() => setNotification(null), 8000);
    });

    socket.on("fleet_update", (fleet) => {
      const car = fleet["Car 101"];

      if (car) {
        setOfficerLocation({
          lat: car[0],
          lng: car[1],
        });
      }
    });

    return () => {
      socket.off("dispatch_alert");
      socket.off("deployment_update");
      socket.off("fleet_update");
    };
  }, []);

  // Recalculate route
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
        } else {
          console.error("Directions failed:", status);
        }
      }
    );
  }, [officerLocation, crimeLocation]);

  const loadPatrolRoute = async () => {
    try {
      const response = await fetch(
        "http://localhost:8000/phase2/generate-route/101",
        {
          method: "POST",
        }
      );

      const data = await response.json();

      if (data.status === "success" && data.route_data) {
        setIsPatrolling(true);

        setPatrolTime(
          `${Math.round(data.route_data.total_route_time_minutes)} mins`
        );

        const patrolNodes = data.route_data.master_patrol_loop;
        const waypoints = patrolNodes.slice(1, -1).map((p: any) => ({
          location: { lat: p.lat, lng: p.lng },
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
              console.error("Patrol route failed:", status);
            }
          }
        );
      }
    } catch (error) {
      console.error("Error loading patrol route:", error);
    }
  };

  return (
    <LoadScript
      googleMapsApiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
    >
      {/* Notification */}
      {notification && (
        <div
          style={{
            position: "absolute",
            top: 20,
            right: 20,
            zIndex: 9999,
            background: "#ef4444",
            color: "white",
            padding: "15px 20px",
            borderRadius: "10px",
            fontWeight: "bold",
          }}
        >
          {notification}
        </div>
      )}

      <div
        style={{
          position: "absolute",
          top: 20,
          left: 20,
          zIndex: 10,
          background: "white",
          padding: "15px",
          borderRadius: "8px",
        }}
      >
        <h2>Officer 101 Dashboard</h2>

        <button onClick={loadPatrolRoute}>
          Start Routine Patrol
        </button>

        {isPatrolling && patrolTime && (
          <p>Estimated Patrol: {patrolTime}</p>
        )}
      </div>

      <GoogleMap
        mapContainerStyle={{ width: "100%", height: "90vh" }}
        center={policeStation}
        zoom={12}
      >
        <Marker position={policeStation} label="HQ" />

        {officerLocation && (
          <Marker
            position={officerLocation}
            label="🚓"
          />
        )}

        {crimeLocation && (
          <Marker
            position={crimeLocation}
            label="🚨"
          />
        )}

        {directions && (
          <DirectionsRenderer
            directions={directions}
            options={{
              polylineOptions: {
                strokeColor: isPatrolling
                  ? "#aa3bff"
                  : "#ff0000",
                strokeWeight: 5,
              },
            }}
          />
        )}
      </GoogleMap>
    </LoadScript>
  );
}