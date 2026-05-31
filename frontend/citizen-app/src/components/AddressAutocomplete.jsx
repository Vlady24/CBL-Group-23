import { useEffect, useRef } from "react";
import { useMapsLibrary } from "@vis.gl/react-google-maps";

function AddressAutocomplete({ onPlaceSelect }) {
  const inputRef = useRef(null);
  const places = useMapsLibrary("places");

  useEffect(() => {
    if (!places || !inputRef.current) return;

    const autocomplete = new places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: "gb" },
      fields: ["formatted_address", "geometry", "name"]
    });

    autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();

      if (!place.geometry || !place.geometry.location) {
        return;
      }

      const selectedPlace = {
        address: place.formatted_address || place.name,
        latitude: place.geometry.location.lat(),
        longitude: place.geometry.location.lng()
      };

      onPlaceSelect(selectedPlace);
    });
  }, [places, onPlaceSelect]);

  return (
    <input
      ref={inputRef}
      type="text"
      placeholder="Enter address or place"
      autoComplete="off"
    />
  );
}

export default AddressAutocomplete;