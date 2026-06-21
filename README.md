# UK Police Resource Allocation & Routing Dashboard

A full-stack, data-driven application designed to address fragmentation, inefficient resource allocation, and slow response times within the UK policing system. This project was developed as part of the Multi-Disciplinary CBL 4CBLW00 course.

## Overview

Current police response capacity is under immense pressure due to outdated, fragmented systems across 43 independent police forces. To support the transition toward a centralized National Police Service, this project introduces an intelligent coordination system powered by a three-algorithm resource-allocation model. 

The system utilizes a 4 GB SQLite database containing 17 million filtered historical crime records (March 2023 - February 2026) alongside population, geospatial, and workforce capacity data.

## Key Features

* **K-Means Clustering (Demand Profiling):** Groups Lower Layer Super Output Areas (LSOAs) into distinct demand zones (e.g., "Low-demand, volatile" or "High-demand / shoplifting") based on crime rates to guide proactive patrol placement.
* **Travelling Salesman Algorithm (Patrol Routing):** Calculates highly efficient, road-based patrol loops through priority hotspots to maximize visible police presence and proactive deterrence.
* **Reversed Dijkstra (Emergency Dispatch):** Identifies the fastest available patrol unit for a live incident by calculating real-time, traffic-aware road travel times via the Google Maps API, rather than relying on inaccurate straight-line distances.
* **Three Dedicated User Interfaces:**
  * [cite_start]**Citizen App:** Allows individuals to securely share their live GPS coordinates when reporting an active crime[cite: 1377, 1378].
  * **Police Operator Dashboard:** The central control room view displaying active police officers. [cite_start]It enables dispatchers to validate emergency calls, receive caller locations, and assign cases to the nearest available officer in the district[cite: 1380, 1381].
  * **Police Officer Dashboard:** An in-vehicle display showing the officer's routine patrol route. [cite_start]If assigned to a live incident, the dashboard instantly updates to display the best optimized route to the location[cite: 1382, 1383].

## Tech Stack

* **Frontend:** React (TypeScript), Mapbox/Leaflet (for mapping)
* **Backend:** Python
* **Database:** SQLite
* **External APIs:** Google Maps Directions API

## Setup and Installation

### 1. Clone the Repository
Clone this repository to your local machine:
`git clone https://github.com/Vlady24/CBL-Group-23.git`

### 2. Environment Variables
Create a `.env` file in the following folders: important_stuff_APIs, frontend/citizen-app, frontend/dispatcher-dashboard, and frontend/officer-dashboard and add your Google Maps API key. The system requires this to calculate road networks and travel times, and to trigger the Euclidean distance fallback if the API fails.
`REACT_APP_GOOGLE_MAPS_API_KEY=your_api_key_here`

### 3. Backend Setup (Python)
Navigate to the backend directory, install the required dependencies, and start the backend server, and then the car simulation.
`cd backend`
`uvicorn main:app --reload`
`python simulate_cars_2.py`

### 4. Frontend Setup (React)
Open a new terminal, navigate to the frontend citizen-app dashboard directory, install dependencies, and start the development server.
`cd frontend`
`cd citizen-app`
`npm install`
`npm run dev`

Open a new terminal, navigate to the frontend dispatcher-dashboard directory, install dependencies, and start the development server.
`cd frontend`
`cd dispatcher-dashboard`
`npm install`
`npm run dev`

Open a new terminal, navigate to the frontend officer-dashboard directory, install dependencies, and start the development server.
`cd frontend`
`cd officer-dashboard`
`npm install`
`npm run dev`

After starting the development servers, navigate to each of the local application endpoints (e.g., http://localhost:5173) in your browser.

### 5. Additional Setup
In the Dispatcher Dashboard, choose "Metropolitan Police" from the top searchbar.

## Contributors

* Vladimir Zsehranszky
* Kiruna Vleeschouwer
* Viktoriia Kravchenko
* Bogdan Culea
* Finn van Sleeuwen
* Luuk Peperkamp
