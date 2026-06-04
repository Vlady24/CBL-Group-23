import { useEffect, useState } from "react";
import {
  GoogleMap,
  LoadScript,
  DirectionsRenderer,
  Marker,
} from "@react-google-maps/api";
import {io} from "socket.io-client";

const socket = io("http://localhost:8000");

const policeStation = {
  lat: 52.4831,
  lng: -1.8966,
};

// we assume the officer is parked at this station for now
const officerLocation = {
  lat: 51.509865,
  lng: -0.118092,
};

// defining the shape of the data coming from Python so TS is happy
interface EmergencyData {
  lat : number;
  lng : number;
  message? : string;
}

export default function Map() {
  const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null);
  const [patrolTime, setPatrolTime] = useState<string | null>(null);
  const [isPatrolling, setIsPatrolling] = useState<boolean>(false);

  // Listen for the emergency from backend server
  useEffect(() => {
    socket.on("dispatch_alert", (emergencyData : EmergencyData) => {
      console.log("SOS Received from backend!", emergencyData);

      // Calculating route to the emergency
      calculateRoute(emergencyData.lat, emergencyData.lng);
    });

    // cleanup listener when component unmounts
    return () => {
      socket.off("dispatch_alert");
    };
  }, []);

  // dynamic routing function
  const calculateRoute = (targetLat: number, targetLng: number) => {
    const service = new google.maps.DirectionsService();

    service.route(
      {
        origin: officerLocation, // start at the officer's location
        destination: {lat : targetLat, lng : targetLng}, // drive to the SOS
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

  // TSP Patrol Loop Logic
  const loadPatrolRoute = async() => {
    try {
      // Fetch the TSP route from the Python backend (for now it takes officer 101)
      const response = await fetch("http://localhost:8000/phase2/generate-route/101", {method: "POST"});
      const data = await response.json();

      if (data.status === "success" && data.route_data) {
        setIsPatrolling(true);

        // pull the calculated patrol time
        const totalMinutes = data.route_data.total_route_time_minutes;
        setPatrolTime(`${totalMinutes} mins`);

        // extract the route array
        const patrolNodes = data.route_data.master_patrol_loop;

        // slice the array to remove the first and last element (the station)
        const intermediateStops = patrolNodes.slice(1, -1);

        // format the backend data into Gmaps waypoints
        const waypoints = intermediateStops.map((point: any) => ({
          location: {lat: point.lat, lng: point.lng},
          stopover: true,
        }));

        const service = new google.maps.DirectionsService();

        service.route(
          {
            origin: policeStation,
            destination: policeStation, // closed loop
            waypoints: waypoints,
            optimizeWaypoints: false,
            travelMode: google.maps.TravelMode.DRIVING,
          },
          (result,status) => {
            if (status === "OK" && result) {
              setDirections(result);
            } else {
              console.error("Google Maps failed to route waypoints:", status);
            }
          }
        );
      }
    } catch (error) {
      console.error("Error fetching patrol route:", error);
    }
  };

  return (
    <LoadScript googleMapsApiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}>

      {/* Dashboard UI Overlay to trigger the route and show time */}
      <div style={{ position: "absolute", top: 20, left: 20, zIndex: 10, background: "white", padding: "15px", borderRadius: "8px", boxShadow: "0 4px 6px rgba(0,0,0,0.1)", fontFamily: "sans-serif" }}>
        <h2 style={{ margin: "0 0 10px 0", fontSize: "18px", color: "#08060d" }}>Officer 101 Dashboard</h2>
        
        <button 
          onClick={loadPatrolRoute}
          style={{ background: "#aa3bff", color: "white", border: "none", padding: "10px 15px", borderRadius: "5px", cursor: "pointer", fontWeight: "bold", width: "100%" }}
        >
          Start Routine Patrol
        </button>

        {isPatrolling && patrolTime && (
          <div style={{ marginTop: "15px", padding: "10px", background: "rgba(170, 59, 255, 0.1)", borderRadius: "5px", border: "1px solid rgba(170, 59, 255, 0.5)" }}>
            <p style={{ margin: 0, fontSize: "14px", color: "#6b6375" }}>Estimated Patrol Time:</p>
            <p style={{ margin: 0, fontSize: "24px", color: "#aa3bff", fontWeight: "bold" }}>{patrolTime}</p>
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
              // This option hides the default A/B/C routing markers if we want a clearer map
              // suppressMarkers: true, 
              polylineOptions: {
                strokeColor: isPatrolling ? "#aa3bff" : "#ff0000",
                strokeWeight: 5,
              }
            }}
          />
        )}
      </GoogleMap>
    </LoadScript>
  );
}