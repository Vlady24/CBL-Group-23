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

const officerLocation = {
  lat: 51.509865,
  lng: -0.118092,
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

  useEffect(() => {
    // Register this officer with backend
    socket.emit("register_officer", {
      officer_id: "101",
    });

    // Existing SOS event
    socket.on("dispatch_alert", (emergencyData: EmergencyData) => {
      console.log("SOS Received from backend!", emergencyData);

      calculateRoute(emergencyData.lat, emergencyData.lng);
    });

    socket.on("officer_dispatch", (data: any) => {
      console.log("Dispatcher assigned incident:", data);

      // stop patrol mode
      setIsPatrolling(false);

      setNotification(
        `DISPATCHED TO ${data.incident_id}${
          data.message ? ` - ${data.message}` : ""
        }`
      );

      calculateRoute(data.lat, data.lng);

      setTimeout(() => {
        setNotification(null);
      }, 10000);
    });

    return () => {
      socket.off("dispatch_alert");
      socket.off("officer_dispatch");
    };
  }, []);

  const calculateRoute = (targetLat: number, targetLng: number) => {
    const service = new google.maps.DirectionsService();

    service.route(
      {
        origin: officerLocation,
        destination: {
          lat: targetLat,
          lng: targetLng,
        },
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === "OK" && result) {
          setDirections(result);
        } else {
          console.error("Failed to fetch directions:", status);
        }
      }
    );
  };

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

        const totalMinutes =
          data.route_data.total_route_time_minutes;

        setPatrolTime(`${Math.round(totalMinutes)} mins`);

        const patrolNodes =
          data.route_data.master_patrol_loop;

        const intermediateStops =
          patrolNodes.slice(1, -1);

        const waypoints = intermediateStops.map(
          (point: any) => ({
            location: {
              lat: point.lat,
              lng: point.lng,
            },
            stopover: true,
          })
        );

        const service =
          new google.maps.DirectionsService();

        service.route(
          {
            origin: policeStation,
            destination: policeStation,
            waypoints,
            optimizeWaypoints: false,
            travelMode:
              google.maps.TravelMode.DRIVING,
          },
          (result, status) => {
            if (status === "OK" && result) {
              setDirections(result);
            } else {
              console.error(
                "Google Maps failed to route waypoints:",
                status
              );
            }
          }
        );
      }
    } catch (error) {
      console.error(
        "Error fetching patrol route:",
        error
      );
    }
  };

  return (
    <LoadScript
      googleMapsApiKey={
        import.meta.env.VITE_GOOGLE_MAPS_API_KEY
      }
    >
      {/* Dispatcher Notification */}
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
            boxShadow:
              "0 4px 12px rgba(0,0,0,0.25)",
            fontWeight: "bold",
            fontSize: "16px",
            minWidth: "300px",
          }}
        >
          {notification}
        </div>
      )}

      {/* Dashboard UI */}
      <div
        style={{
          position: "absolute",
          top: 20,
          left: 20,
          zIndex: 10,
          background: "white",
          padding: "15px",
          borderRadius: "8px",
          boxShadow:
            "0 4px 6px rgba(0,0,0,0.1)",
          fontFamily: "sans-serif",
        }}
      >
        <h2
          style={{
            margin: "0 0 10px 0",
            fontSize: "18px",
            color: "#08060d",
          }}
        >
          Officer 101 Dashboard
        </h2>

        <button
          onClick={loadPatrolRoute}
          style={{
            background: "#aa3bff",
            color: "white",
            border: "none",
            padding: "10px 15px",
            borderRadius: "5px",
            cursor: "pointer",
            fontWeight: "bold",
            width: "100%",
          }}
        >
          Start Routine Patrol
        </button>

        {isPatrolling && patrolTime && (
          <div
            style={{
              marginTop: "15px",
              padding: "10px",
              background:
                "rgba(170, 59, 255, 0.1)",
              borderRadius: "5px",
              border:
                "1px solid rgba(170, 59, 255, 0.5)",
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: "14px",
                color: "#6b6375",
              }}
            >
              Estimated Patrol Time:
            </p>

            <p
              style={{
                margin: 0,
                fontSize: "24px",
                color: "#aa3bff",
                fontWeight: "bold",
              }}
            >
              {patrolTime}
            </p>
          </div>
        )}
      </div>

      <GoogleMap
        mapContainerStyle={{
          width: "100%",
          height: "90vh",
        }}
        center={policeStation}
        zoom={12}
      >
        <Marker
          position={policeStation}
          label="HQ"
          title="Birmingham Central HQ Depot"
        />

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