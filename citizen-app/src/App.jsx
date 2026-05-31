import { useState } from "react";
import { APIProvider } from "@vis.gl/react-google-maps";
import AddressAutocomplete from "./components/AddressAutocomplete";
import "./App.css";

function App() {
  const [screen, setScreen] = useState("home");
  const [crimeType, setCrimeType] = useState("");
  const [details, setDetails] = useState("");
  const [locationMode, setLocationMode] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [addressText, setAddressText] = useState("");

  // store all reports created during current session
  const [reports, setReports] = useState([]);

  // Fake locations: when the user clicks "Use my location", one of these coordinates is randomly selected. 
  // this is done only for the demo purposes to simulate the functionality of the button 
  const fakeIncidentLocations = [
    // West Midlands
    { id: "demo_loc_001", latitude: 52.486781, longitude: -1.892418 },
    { id: "demo_loc_002", latitude: 52.475932, longitude: -1.91721 },
    { id: "demo_loc_003", latitude: 52.501114, longitude: -1.863742 },
    { id: "demo_loc_004", latitude: 52.412947, longitude: -1.778661 },
    { id: "demo_loc_005", latitude: 52.586804, longitude: -1.983992 },

    // London
    { id: "demo_loc_006", latitude: 51.501994, longitude: -0.141612 },
    { id: "demo_loc_007", latitude: 51.51839, longitude: -0.119875 },
    { id: "demo_loc_008", latitude: 51.539861, longitude: -0.143982 },
    { id: "demo_loc_009", latitude: 51.545821, longitude: -0.05643 },
    { id: "demo_loc_010", latitude: 51.523771, longitude: -0.076419 },
    { id: "demo_loc_011", latitude: 51.497603, longitude: -0.063442 },
    { id: "demo_loc_012", latitude: 51.471922, longitude: -0.092816 },
    { id: "demo_loc_013", latitude: 51.376984, longitude: -0.099271 },
    { id: "demo_loc_014", latitude: 51.513846, longitude: -0.307614 },
    { id: "demo_loc_015", latitude: 51.594217, longitude: -0.111392 },

    // Merseyside
    { id: "demo_loc_016", latitude: 53.407921, longitude: -2.991104 },
    { id: "demo_loc_017", latitude: 53.399485, longitude: -2.969322 },
    { id: "demo_loc_018", latitude: 53.431204, longitude: -2.961588 },
    { id: "demo_loc_019", latitude: 53.445891, longitude: -2.989706 },
    { id: "demo_loc_020", latitude: 53.456947, longitude: -2.738615 }
  ];

  // unique id for every report
  function generateIncidentId() {
    return "INC-" + Date.now();
  }
  
  // randomly select one of the coordinates above
  function useDeviceLocation() {
    const randomIndex = Math.floor(Math.random() * fakeIncidentLocations.length);
    const location = fakeIncidentLocations[randomIndex];

    setLatitude(location.latitude.toFixed(6));
    setLongitude(location.longitude.toFixed(6));
    setAddressText("");
    setLocationMode("simulated_device_location");
  }

  // when the user selects google address, save both address and coordinates
  function handleAddressSelect(place) {
    setAddressText(place.address);
    setLatitude(place.latitude.toFixed(6));
    setLongitude(place.longitude.toFixed(6));
    setLocationMode("google_address_search");
  }

  // create report and add to dispatcher preview
  function sendReport() {
    if (!crimeType) {
      alert("Please select a crime type.");
      return;
    }

    if (!latitude || !longitude) {
      alert("Please add a location by using current location or entering an address.");
      return;
    }

    const report = {
      incidentId: generateIncidentId(),
      crimeType: crimeType,
      latitude: Number(latitude),
      longitude: Number(longitude),
      status: "pending",
      time: new Date().toLocaleString(),
      crimeDetails: details,
      locationSource: locationMode,
      addressText: addressText,
      reporter: "Verified reporter #0241"
    };

    setReports([report, ...reports]);

    setCrimeType("");
    setDetails("");
    setLatitude("");
    setLongitude("");
    setAddressText("");
    setLocationMode("");
    setScreen("home");
  }

  return (
    <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}>
      <div className="app">
        <div className="phone">
          {screen === "home" && (
            <div className="card">
              <div className="badge">Citizen App</div>

              <h1>Report an incident</h1>

              <p className="muted">
                Send incident type, location, and optional details to the dispatcher.
              </p>

              <button className="primary-button" onClick={() => setScreen("report")}>
                Report a crime
              </button>
            </div>
          )}

          {screen === "report" && (
            <div className="card">
              <button className="back-button" onClick={() => setScreen("home")}>
                ← Back
              </button>

              <h1>Incident report</h1>

              <label>Crime type</label>

              <select value={crimeType} onChange={(e) => setCrimeType(e.target.value)}>
                <option value="">Select crime type</option>
                <option value="violence">Violence or threat</option>
                <option value="anti-social behaviour">Anti-social behaviour</option>
                <option value="theft">Theft / robbery / burglary</option>
                <option value="vehicle crime">Vehicle crime</option>
                <option value="public order">Public disorder</option>
                <option value="weapons">Weapons-related incident</option>
                <option value="other">Other / not sure</option>
              </select>

              <label>What is happening? Optional</label>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Add details if there is time..."
              />

              <label>Location</label>

              <div className="location-buttons">
                <button onClick={useDeviceLocation}>Use my location</button>
              </div>

              <div className="address-search">
                <label>Or enter address / place</label>
                <AddressAutocomplete onPlaceSelect={handleAddressSelect} />
              </div>

              <button className="primary-button" onClick={sendReport}>
                Send report
              </button>
            </div>
          )}
        </div>

        <div className="dispatcher-preview">
          <h2>Dispatcher preview</h2>

          {reports.length === 0 ? (
            <div className="empty-box">No reports received yet.</div>
          ) : (
            reports.map((report) => (
              <div className="report-card" key={report.incidentId}>
                <div className="report-header">
                  <strong>{report.incidentId}</strong>
                  <span>{report.status}</span>
                </div>

                <p>
                  <b>Crime type:</b> {report.crimeType}
                </p>

                <p>
                  <b>Latitude:</b> {report.latitude}
                </p>

                <p>
                  <b>Longitude:</b> {report.longitude}
                </p>

                <p>
                  <b>Address:</b> {report.addressText || "Not provided"}
                </p>

                <p>
                  <b>Time:</b> {report.time}
                </p>

                <p>
                  <b>Location source:</b> {report.locationSource}
                </p>

                <p>
                  <b>Reporter:</b> {report.reporter}
                </p>

                <p>
                  <b>Details:</b> {report.crimeDetails || "No details provided"}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </APIProvider>
  );
}

export default App;