import { useEffect, useState } from "react";
import {
  GoogleMap,
  LoadScript,
  DirectionsRenderer,
} from "@react-google-maps/api";
import {io} from "socket.io-client";

const socket = io("http://localhost:8000");

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

  return (
    <LoadScript googleMapsApiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}>
      <GoogleMap
        mapContainerStyle={{
          width: "100%",
          height: "90vh",
        }}
        center={officerLocation}
        zoom={15}
      >
        {directions && (
          <DirectionsRenderer directions={directions} />
        )}
      </GoogleMap>
    </LoadScript>
  );
}