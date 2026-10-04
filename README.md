# Flood Watch Live

Prompt: Urban Flood Nowcasting System — Complete Working Prototype

Build a high-fidelity, functional prototype for an Urban Flood Nowcasting System (0–3 Hour Lead Time) designed for major Indian cities such as Delhi, Mumbai, or Chennai.

The prototype should demonstrate the complete end-to-end process, from rainfall input to flood prediction, drainage analysis, GIS visualization, and flood-safe routing.

The system should look like a professional disaster-management / municipal command-center platform rather than a generic dashboard.

1. CORE OBJECTIVE

The system's purpose is:

Rainfall Nowcast → Surface Runoff → Terrain Flow → Drainage Network → Drainage Capacity → Surcharge/Overflow → Street-Level Flood Depth → Risk Prediction → Flood Map → Safe Route

The system should predict:

Where flooding will occur

When flooding will occur

Estimated flood depth in centimeters

Drainage locations likely to become overloaded

Roads/intersections at risk

Safer alternative routes for emergency services

Prediction window:

Current time → +30 min → +60 min → +90 min → +120 min → +180 min

2. SYSTEM ARCHITECTURE

Implement the following architecture:

                    RAINFALL DATA
                         │
                         ▼
               ┌───────────────────┐
               │ Rainfall Nowcast  │
               │ 0–3 hour forecast │
               └─────────┬─────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │ GIS / Terrain Data  │
              │ DEM + Roads + Land  │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │ Surface Runoff      │
              │ Calculation         │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │ 2D Surface Flow     │
              │ Grid Simulation     │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │ Drainage Graph      │
              │ Nodes + Pipes       │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │ Hydraulic Capacity  │
              │ / Surcharge Model   │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │ ML Flood Prediction │
              │ XGBoost Model       │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │ Flood Risk Engine   │
              └──────────┬──────────┘
                         │
                 ┌───────┴────────┐
                 ▼                ▼
           GIS FLOOD MAP      ROUTING ENGINE
                 │                │
                 └───────┬────────┘
                         ▼
                 WEB GIS DASHBOARD


3. CITY / STUDY AREA

Create a selectable study area representing a small urban region, approximately 1–5 km², rather than attempting to simulate an entire city.

Provide a city selector:

Delhi

Mumbai

Chennai

For the prototype, use synthetic/demo geographical data if real municipal drainage data is unavailable.

Clearly label simulated data as:

"Prototype / Simulated Data"

Do not claim that synthetic data represents actual municipal measurements.

4. GIS / TERRAIN MODULE

Create a high-resolution grid representing the urban area.

Each grid cell should contain:

Latitude

Longitude

Elevation

Slope

Flow direction

Flow accumulation

Impervious surface percentage

Land-use type

Road/building information

Nearest drainage inlet

Current water depth

Example:

Grid Cell 1023

Elevation: 96.2 m
Slope: 0.4%
Imperviousness: 91%
Flow accumulation: High
Nearest drain: 18 m
Current water depth: 6 cm


Display the terrain and flood information on an interactive GIS map.

5. RAINFALL NOWCAST MODULE

Create a simulated real-time rainfall input system.

Allow the user to either:

A. Enter rainfall manually

Example:

Rainfall intensity:
72 mm/hour


OR

B. Select predefined rainfall scenarios

Light Rain

Moderate Rain

Heavy Rain

Extreme Rain

Custom

Generate rainfall predictions for:

Now
+30 min
+60 min
+90 min
+120 min
+180 min


Example:

TimeRainfallNow40 mm/hr+30 min55 mm/hr+60 min72 mm/hr+90 min80 mm/hr+120 min60 mm/hr+180 min35 mm/hr

Display rainfall intensity as a time-series graph.

6. RAINFALL → RUNOFF CALCULATION

Convert rainfall into surface runoff.

Use:

Runoff Volume =
Rainfall Depth × Area × Runoff Coefficient


Use different runoff coefficients for surfaces:

SurfaceRunoff coefficientConcrete0.90Asphalt0.85Buildings0.95Grass0.30Soil0.20

Calculate runoff for every grid cell.

Display:

Rainfall
   ↓
Surface type
   ↓
Runoff coefficient
   ↓
Runoff volume


7. 2D SURFACE WATER FLOW

Represent the city as a grid:

┌────┬────┬────┬────┐
│ C1 │ C2 │ C3 │ C4 │
├────┼────┼────┼────┤
│ C5 │ C6 │ C7 │ C8 │
├────┼────┼────┼────┤
│ C9 │C10 │C11 │C12 │
└────┴────┴────┴────┘


Determine the flow direction using elevation.

Water should preferentially move:

Higher elevation → Lower elevation

Calculate:

Water accumulation

Flow direction

Surface storage

Flow between neighboring cells

Flood depth

Low-lying cells should naturally accumulate more water.

8. DRAINAGE NETWORK MODULE

Represent the underground drainage network as a directed graph.

Nodes:

Manholes

Stormwater inlets

Junctions

Outfalls

Edges:

Pipes

Drains

Canals

Example:

             M1
            /  \
           ▼    ▼
          M2    M3
           \    /
            ▼  ▼
             M4
              │
              ▼
            Outlet


Each pipe should have:

Diameter

Length

Slope

Roughness

Hydraulic capacity

Current flow

Each node should have:

Current water level

Incoming flow

Outgoing flow

Maximum capacity

9. HYDRAULIC CAPACITY

Calculate approximate drainage capacity.

Use the Manning equation:

Q = (1/n) × A × R^(2/3) × S^(1/2)

where:

Q = discharge capacity

n = Manning roughness coefficient

A = pipe cross-sectional area

R = hydraulic radius

S = pipe slope

For the prototype, allow simplified/simulated pipe parameters.

Calculate:

Drain Utilization =
Incoming Flow / Drain Capacity × 100


Example:

Incoming flow = 5 m³/s
Drain capacity = 3 m³/s

Utilization = 167%

Excess = 2 m³/s


10. DRAINAGE SURCHARGE / BLOCKAGE

Identify drainage failure conditions.

Example:

Drain utilization < 80%
→ Normal

80–100%
→ Near capacity

100–120%
→ Overloaded

>120%
→ Severe surcharge


Also allow simulated blockages.

Example:

Pipe P17
Normal capacity: 3.5 m³/s
Blockage: 40%
Effective capacity: 2.1 m³/s


When drainage capacity is exceeded, route the excess water back onto the surface.

11. FLOOD DEPTH MODEL

For every grid cell calculate:

Current water depth
+
Incoming surface runoff
+
Upstream water
-
Drainage removal
-
Outflow
=
New water depth


Generate flood-depth predictions for:

+30 min
+60 min
+90 min
+120 min
+180 min


Example:

Intersection A

Current: 5 cm
+30 min: 8 cm
+60 min: 18 cm
+90 min: 31 cm
+120 min: 42 cm
+180 min: 25 cm


12. MACHINE LEARNING MODULE

Implement an XGBoost regression model as the prototype ML component.

The ML model should predict flood depth.

Features:

Rainfall
Rainfall_15min
Rainfall_30min
Rainfall_60min
Forecast rainfall
Elevation
Slope
Flow accumulation
Imperviousness
Drain capacity
Drain utilization
Previous water depth
Distance to drain


Target:

Flood depth in cm


13. SYNTHETIC TRAINING DATA GENERATOR

Do NOT manually enter thousands of fake rows.

Create a Python-based synthetic data generator.

Generate thousands of scenarios by varying:

Rainfall

Elevation

Slope

Imperviousness

Drain capacity

Drain blockage

Previous water depth

Flow accumulation

Use the physics-inspired flood simulation to calculate the corresponding simulated flood depth.

Generate a dataset such as:

rainfall,elevation,slope,imperviousness,
drain_capacity,drain_utilization,
previous_depth,flood_depth


Example:

80,96,0.3,92,2.0,1.15,6,31.7
42,103,1.2,65,5.0,0.55,1,3.2
65,99,0.5,85,2.8,0.92,4,17.4
110,94,0.2,96,1.5,1.45,10,52.8


Generate at least several thousand training scenarios automatically.

14. ML TRAINING PIPELINE

Implement:

Synthetic scenarios
       ↓
Feature extraction
       ↓
Training dataset
       ↓
Train/Test split
       ↓
XGBoost training
       ↓
Validation
       ↓
Saved trained model


Do not randomly split rows from the same simulated storm into training and testing if avoidable. Prefer splitting by rainfall/storm scenarios.

Show model metrics:

MAE

RMSE

R²

Display them in the dashboard.

Clearly state:

"Prototype ML model trained on simulated scenarios."

15. FLOOD RISK CLASSIFICATION

Convert predicted flood depth into risk categories.

Use configurable prototype thresholds such as:

0–5 cm       → SAFE
5–15 cm      → LOW
15–30 cm     → MODERATE
30–50 cm     → HIGH
>50 cm       → SEVERE


Display these as a map legend.

Do not imply these thresholds are official municipal safety standards.

16. 0–3 HOUR NOWCAST

The main dashboard should show a timeline:

NOW ─── +30 ─── +60 ─── +90 ─── +120 ─── +180 min


Allow the user to move a timeline slider.

When the slider changes:

Update flood map

Update flood depth

Update affected roads

Update drainage status

Update risk statistics

Update safe route

17. FLOOD MAP

Create an interactive GIS map.

Display:

Layers

Base map

Roads

DEM/elevation

Rainfall

Drainage network

Manholes

Flood depth

Flood-risk zones

Emergency route

The flood layer should visually represent:

Safe
Low
Moderate
High
Severe


Use a clear sequential risk visualization.

Clicking a flooded road should open a popup:

ROAD: Example Road

Current depth: 8 cm
Predicted depth: 34 cm
Prediction time: +60 min

Drain utilization: 121%
Rainfall: 72 mm/hr

Risk: HIGH


18. KEY FLOOD HOTSPOTS

Automatically identify areas where flooding is most severe.

Calculate a hotspot score based on:

Flood depth
+
Flood duration
+
Drain utilization
+
Flow accumulation
+
Road importance


Rank the top locations.

Example:

TOP FLOOD HOTSPOTS

1. Intersection A
   Predicted depth: 48 cm
   Time: +90 min

2. Road B
   Predicted depth: 41 cm
   Time: +60 min

3. Junction C
   Predicted depth: 37 cm
   Time: +120 min


19. SAFE ROUTE MODULE

Create a flood-aware road routing system.

Use a road graph.

Assign a cost to each road based on flood depth.

Example:

Safe road       → Low cost
5–15 cm         → Moderate cost
15–30 cm        → High cost
30–50 cm        → Very high cost
>50 cm          → Avoid


Use Dijkstra or A* to find the safest/fastest route.

Allow the user to enter:

Start location
Destination
Vehicle type


Vehicle types:

Ambulance

Fire truck

Police

Public transport

Normal vehicle

Emergency vehicles should have stricter flood-depth avoidance.

Display:

NORMAL ROUTE
Distance: 5.2 km
Flood exposure: HIGH

RECOMMENDED SAFE ROUTE
Distance: 6.1 km
Flood exposure: LOW
Maximum depth: 8 cm


20. EMERGENCY ALERTS

Generate automatic alerts when predicted flood depth exceeds thresholds.

Example:

⚠️ FLOOD ALERT

Location: Junction A

Expected flooding:
34 cm

Time to critical flooding:
47 minutes

Drainage:
127% capacity

Recommended action:
Avoid this intersection.


21. DASHBOARD LAYOUT

Create a professional dashboard with:

Header

URBAN FLOOD NOWCASTING SYSTEM
Real-Time Urban Flood Intelligence


Left sidebar

City
Rainfall Scenario
Prediction Time
Layers
Risk Filters


Main area

Large interactive GIS map.

Right panel

Show:

Current Rainfall
Predicted Rainfall
Flooded Roads
Maximum Flood Depth
Critical Drains
People/road segments at risk


Bottom panel

Show:

Rainfall graph

Flood-depth forecast

Drain capacity graph

22. END-TO-END SIMULATION BUTTON

Add a prominent button:

"RUN FLOOD NOWCAST"

When clicked, animate the entire process:

1. Loading rainfall forecast
        ↓
2. Processing terrain
        ↓
3. Calculating runoff
        ↓
4. Routing surface water
        ↓
5. Processing drainage graph
        ↓
6. Calculating hydraulic capacity
        ↓
7. Detecting drainage surcharge
        ↓
8. Running ML prediction
        ↓
9. Generating flood map
        ↓
10. Calculating safe routes
        ↓
11. Generating alerts


Display progress during the simulation.

23. END-OF-SIMULATION SUMMARY

After the simulation finishes, show:

FLOOD NOWCAST SUMMARY

Rainfall:
72 mm/hr

Prediction window:
3 hours

Flooded road segments:
27

Critical drainage nodes:
8

Maximum predicted depth:
48 cm

Highest-risk location:
Intersection A

Time to critical flooding:
47 minutes

Recommended emergency action:
Avoid 3 road segments


24. REQUIRED FINAL GRAPH

At the end of the dashboard, create a Key Areas / Flood Hotspot graph.

The graph should rank the most vulnerable locations.

Use a bar chart.

Example:

Predicted Maximum Flood Depth

Intersection A  ████████████████████ 48 cm
Road B          █████████████████    41 cm
Junction C      ███████████████      37 cm
Road D          ████████████         31 cm
Intersection E  █████████            24 cm


The graph should dynamically update based on the selected rainfall scenario and prediction time.

Also allow the user to click a bar and automatically zoom the GIS map to that location.

25. SECOND IMPORTANT GRAPH

Also include a line chart:

Flood Depth vs Time

Example:

Depth
50cm |                 ●
40cm |             ●───
30cm |         ●───
20cm |     ●───
10cm | ●───
 0cm |________________________
       Now 30  60  90 120 180
               Minutes


This demonstrates the 0–3 hour nowcasting capability.

26. TECH STACK

Use:

Backend

Python

FastAPI

Data / Scientific Computing

NumPy

Pandas

SciPy

GIS

GeoPandas

Rasterio

Shapely

GDAL

ML

XGBoost

scikit-learn

Graphs

NetworkX

Database

PostgreSQL

PostGIS

Frontend

React

JavaScript/TypeScript

Maps

Leaflet

Routing

OpenStreetMap road data

A* / Dijkstra

OSRM or OpenRouteService where appropriate

27. PROTOTYPE DATA

Because this is a prototype, create realistic simulated datasets for:

Rainfall

DEM

Drainage network

Pipe capacity

Manholes

Imperviousness

Historical flood scenarios

However, structure the system so that these simulated inputs can later be replaced with:

Doppler weather radar rainfall

Real DEM

Municipal drainage data

IoT water-level sensors

Historical flood observations

Satellite imagery

Real road networks

Clearly distinguish real data, simulated data, and model-generated predictions in the UI.

28. IMPORTANT DESIGN PRINCIPLE

The project should NOT be presented as:

"AI predicts floods."

It should be presented as:

"A coupled rainfall–terrain–drainage–ML system for street-level urban flood nowcasting."

The physics-based model should handle water movement and drainage behavior.

The ML model should provide fast flood-depth predictions based on the generated features.

This creates a hybrid physics + machine-learning architecture.

29. FINAL USER FLOW

The complete prototype should demonstrate this exact sequence:

USER OPENS DASHBOARD
        ↓
SELECTS CITY
        ↓
SELECTS RAINFALL SCENARIO
        ↓
SYSTEM LOADS TERRAIN
        ↓
SYSTEM LOADS ROAD NETWORK
        ↓
SYSTEM LOADS DRAINAGE NETWORK
        ↓
RAINFALL NOWCAST GENERATED
        ↓
RAINFALL CONVERTED TO RUNOFF
        ↓
WATER ROUTED ACROSS 2D TERRAIN
        ↓
WATER ENTERS DRAINAGE NETWORK
        ↓
DRAIN CAPACITY CALCULATED
        ↓
OVERLOADED/BLOCKED DRAINS DETECTED
        ↓
EXCESS WATER RETURNS TO SURFACE
        ↓
FLOOD DEPTH CALCULATED
        ↓
XGBOOST PREDICTS FUTURE FLOOD DEPTH
        ↓
0–3 HOUR FLOOD MAP GENERATED
        ↓
FLOOD HOTSPOTS IDENTIFIED
        ↓
ROAD RISK CALCULATED
        ↓
SAFE ROUTE GENERATED
        ↓
ALERTS GENERATED
        ↓
FINAL HOTSPOT GRAPH DISPLAYED


30. SUCCESS CRITERIA

The prototype is successful if a user can:

Select a city/area.

Select or enter rainfall.

Run the flood simulation.

See rainfall predictions.

See surface-water movement.

See drainage network behavior.

See overloaded drainage nodes.

See predicted flood depth.

Move through the 0–3 hour timeline.

Identify dangerous roads.

Click a flooded location for detailed information.

Request a safer route.

See the recommended route on the map.

See the top flood-prone/key areas.

See the final Key Areas / Maximum Flood Depth bar graph.

See a Flood Depth vs Time prediction graph.

The prototype should prioritize functional end-to-end demonstration over visual complexity. Every dashboard component should be connected to the underlying simulation rather than being a static mockup.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/e7733045-0ba8-43b8-a7de-06a2d816c720).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
