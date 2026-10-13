# Interactive Flood-Aware Street Map

## Goal
Upgrade the current dashboard’s central map with a real, pan-and-zoom street basemap, while keeping the existing dashboard, flood simulation and controls intact.

## Work
1. Replace the synthetic canvas renderer with a MapLibre-based street map, loaded only in the browser and using an openly accessible, attributed tile style.
2. Project the existing simulation’s flood, drainage, hotspot and recommended/fastest route information as geographic map layers; connect the current city selector, layer switches, risk filter, timeline, hotspot focus and click-to-inspect behavior.
3. Keep demo/simulated information clearly labeled, provide a useful fallback if map tiles cannot load, and document the map’s data-source and routing limitations.
4. Validate the existing city/map interactions and route behavior, then check the preview diagnostics and required route metadata.

## Technical details
- Keep TanStack Start and the existing flood engine; do not add server features or replace dashboard controls.
- Isolate MapLibre imports and browser APIs from SSR; preserve map instances as inputs and overlays update.
- Use the current simulated road graph and routing results unless a dependable external road-data/routing service is available without credentials; do not present simulated results as live feeds.
