import { useState } from "react";
import {
  GoogleMap,
  LoadScript,
  DirectionsRenderer,
} from "@react-google-maps/api";

const center = {
  lat: 51.509865,
  lng: -0.118092,
};

export default function Map() {
  const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null);

  const calculateRoute = () => {
    const service = new google.maps.DirectionsService();

    service.route(
      {
        origin: { lat: 51.509865, lng: -0.118092 },
        destination: { lat: 51.50853, lng:  -0.12574 },
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === "OK" && result) {
          setDirections(result);
        }
      }
    );
  };

  return (
    <LoadScript googleMapsApiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}>
      <button onClick={calculateRoute}>
        Calculate Route
      </button>

      <GoogleMap
        mapContainerStyle={{
          width: "100%",
          height: "90vh",
        }}
        center={center}
        zoom={15}
      >
        {directions && (
          <DirectionsRenderer directions={directions} />
        )}
      </GoogleMap>
    </LoadScript>
  );
}