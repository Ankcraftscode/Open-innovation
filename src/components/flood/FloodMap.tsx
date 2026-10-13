import { useCallback, useEffect, useRef, useState } from "react";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import {
  GRID,
  RISK_COLOR,
  riskOf,
  roadDepth,
  type Hotspot,
  type RoadSeg,
  type RouteResult,
  type StepResult,
  type Terrain,
} from "@/lib/flood/engine";

export interface Layers {
  elevation: boolean;
  flood: boolean;
  roads: boolean;
  drainage: boolean;
  manholes: boolean;
  rainfall: boolean;
  hotspots: boolean;
  route: boolean;
}

export interface MapSelection {
  kind: "road" | "cell";
  name: string;
  cell: number;
  depth: number;
  drainUtil: number;
  drainName: string;
  elev: number;
  slope: number;
  imperv: number;
  flowAcc: number;
  drainDist: number;
  road?: RoadSeg;
}

interface Props {
  terrain: Terrain;
  step: StepResult | null;
  layers: Layers;
  hotspots: Hotspot[];
  route: RouteResult | null;
  altRoute: RouteResult | null;
  focus: { lat: number; lng: number } | null;
  minRisk: number;
  rainfall: number;
  onSelect: (selection: MapSelection) => void;
}

const EMPTY_DATA: FeatureCollection = { type: "FeatureCollection", features: [] };
const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
const RISK_LEVELS = ["SAFE", "LOW", "MODERATE", "HIGH", "SEVERE"];
const GEOJSON_SOURCES = ["terrain", "flood", "rainfall", "roads", "drains", "manholes", "hotspots", "routes"];

function polygonFeature(
  cell: Terrain["cells"][number],
  halfLat: number,
  halfLng: number,
  properties: Record<string, number | string>,
): Feature<Geometry, Record<string, number | string>> {
  const { lat, lng } = cell;
  return {
    type: "Feature",
    properties,
    geometry: {
      type: "Polygon",
      coordinates: [[
        [lng - halfLng, lat - halfLat],
        [lng + halfLng, lat - halfLat],
        [lng + halfLng, lat + halfLat],
        [lng - halfLng, lat + halfLat],
        [lng - halfLng, lat - halfLat],
      ]],
    },
  };
}

function collection(features: Feature<Geometry, Record<string, number | string>>[]): FeatureCollection {
  return { type: "FeatureCollection", features };
}

function lineFeature(
  coordinates: Position[],
  properties: Record<string, number | string>,
): Feature<Geometry, Record<string, number | string>> {
  return { type: "Feature", properties, geometry: { type: "LineString", coordinates } };
}

export function FloodMap(props: Props) {
  const { terrain, step, layers, hotspots, route, altRoute, focus, minRisk, rainfall, onSelect } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const propsRef = useRef(props);
  const focusRef = useRef(focus);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [coordinates, setCoordinates] = useState<[number, number]>(terrain.city.center);

  propsRef.current = props;

  useEffect(() => {
    let disposed = false;
    let map: MapLibreMap | null = null;
    let errorCount = 0;
    setMapReady(false);
    setMapError(false);

    void import("maplibre-gl").then((maplibre) => {
      if (disposed || !hostRef.current) return;
      map = new maplibre.Map({
        container: hostRef.current,
        style: STYLE_URL,
        center: [terrain.city.center[1], terrain.city.center[0]],
        zoom: 14.2,
        minZoom: 11,
        maxZoom: 19,
        attributionControl: {},
        cooperativeGestures: true,
      });
      mapRef.current = map;
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");
      map.addControl(
        new maplibre.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: false,
          showUserLocation: true,
        }),
        "bottom-right",
      );

      map.once("load", () => {
        if (disposed || !map) return;
        const addGeoSource = (id: string) => map?.addSource(id, { type: "geojson", data: EMPTY_DATA });
        GEOJSON_SOURCES.forEach(addGeoSource);

        map.addLayer({
          id: "terrain-cells",
          type: "fill",
          source: "terrain",
          paint: {
            "fill-color": ["interpolate", ["linear"], ["get", "elevation"], 0, RISK_COLOR.SAFE, 15, RISK_COLOR.LOW],
            "fill-opacity": 0.16,
            "fill-outline-color": "rgba(180, 220, 224, 0.13)",
          },
        });
        map.addLayer({
          id: "rainfall-cells",
          type: "fill",
          source: "rainfall",
          paint: { "fill-color": RISK_COLOR.LOW, "fill-opacity": ["get", "opacity"] },
        });
        map.addLayer({
          id: "flood-cells",
          type: "fill",
          source: "flood",
          paint: {
            "fill-color": ["match", ["get", "risk"], "LOW", RISK_COLOR.LOW, "MODERATE", RISK_COLOR.MODERATE, "HIGH", RISK_COLOR.HIGH, "SEVERE", RISK_COLOR.SEVERE, RISK_COLOR.SAFE],
            "fill-opacity": ["interpolate", ["linear"], ["get", "depth"], 1, 0.22, 50, 0.68],
            "fill-outline-color": "rgba(248, 252, 246, 0.2)",
          },
        });
        map.addLayer({
          id: "drainage-pipes",
          type: "line",
          source: "drains",
          layout: { "line-cap": "round" },
          paint: {
            "line-color": ["case", [">", ["get", "utilization"], 1.2], RISK_COLOR.SEVERE, [">", ["get", "utilization"], 1], RISK_COLOR.HIGH, [">", ["get", "utilization"], 0.8], RISK_COLOR.MODERATE, "#68a3b4"],
            "line-width": 2,
            "line-opacity": 0.85,
            "line-dasharray": [2, 2],
          },
        });
        map.addLayer({
          id: "simulated-road-risk",
          type: "line",
          source: "roads",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["match", ["get", "risk"], "LOW", RISK_COLOR.LOW, "MODERATE", RISK_COLOR.MODERATE, "HIGH", RISK_COLOR.HIGH, "SEVERE", RISK_COLOR.SEVERE, "rgba(238, 245, 248, 0.68)"],
            "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2.5, 17, 5],
            "line-opacity": 0.92,
          },
        });
        map.addLayer({
          id: "fastest-route",
          type: "line",
          source: "routes",
          filter: ["==", ["get", "routeType"], "fastest"],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": RISK_COLOR.MODERATE, "line-width": 3, "line-opacity": 0.8, "line-dasharray": [2, 1.5] },
        });
        map.addLayer({
          id: "recommended-route",
          type: "line",
          source: "routes",
          filter: ["==", ["get", "routeType"], "safest"],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": RISK_COLOR.LOW, "line-width": 5, "line-opacity": 0.98 },
        });
        map.addLayer({
          id: "manhole-points",
          type: "circle",
          source: "manholes",
          paint: {
            "circle-radius": ["case", ["==", ["get", "kind"], "outfall"], 6, 4],
            "circle-color": ["case", [">", ["get", "utilization"], 1.2], RISK_COLOR.SEVERE, [">", ["get", "utilization"], 1], RISK_COLOR.HIGH, [">", ["get", "utilization"], 0.8], RISK_COLOR.MODERATE, "#75cbd4"],
            "circle-stroke-color": "rgba(10, 18, 25, 0.9)",
            "circle-stroke-width": 1.5,
          },
        });
        map.addLayer({
          id: "hotspot-points",
          type: "circle",
          source: "hotspots",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 6, 17, 9],
            "circle-color": RISK_COLOR.MODERATE,
            "circle-stroke-color": "rgba(20, 25, 26, 0.9)",
            "circle-stroke-width": 2,
          },
        });
        map.addLayer({
          id: "hotspot-labels",
          type: "symbol",
          source: "hotspots",
          layout: { "text-field": ["get", "number"], "text-size": 10, "text-font": ["Open Sans Semibold"] },
          paint: { "text-color": "#10191d", "text-halo-color": RISK_COLOR.MODERATE, "text-halo-width": 1 },
        });

        map.on("click", (event) => {
          const current = propsRef.current;
          const { bounds } = current.terrain;
          const fx = (event.lngLat.lng - bounds.minLng) / (bounds.maxLng - bounds.minLng);
          const fy = (bounds.maxLat - event.lngLat.lat) / (bounds.maxLat - bounds.minLat);
          if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
          const col = Math.round(fx * (GRID - 1));
          const row = Math.round(fy * (GRID - 1));
          const cell = current.terrain.cells[row * GRID + col];
          if (!cell) return;

          let bestRoad: RoadSeg | undefined;
          let bestDistance = Infinity;
          for (const road of current.terrain.roads) {
            for (const cellId of road.cells) {
              const candidate = current.terrain.cells[cellId];
              if (!candidate) continue;
              const distance = Math.hypot(candidate.lat - event.lngLat.lat, candidate.lng - event.lngLat.lng);
              if (distance < bestDistance) {
                bestDistance = distance;
                bestRoad = road;
              }
            }
          }
          const tolerance = ((bounds.maxLat - bounds.minLat) / GRID) * 1.5;
          const useRoad = bestRoad && bestDistance < tolerance;
          const drain = current.terrain.drains[cell.drainId];
          const depth = current.step
            ? useRoad && bestRoad
              ? roadDepth(bestRoad, current.step.mlDepth)
              : Math.round((current.step.mlDepth[cell.id] ?? 0) * 10) / 10
            : 0;
          propsRef.current.onSelect({
            kind: useRoad ? "road" : "cell",
            name: useRoad && bestRoad ? bestRoad.name : `Grid Cell ${cell.id}`,
            cell: cell.id,
            depth,
            drainUtil: current.step?.drains[cell.drainId]?.utilization ?? 0,
            drainName: drain?.name ?? "—",
            elev: cell.elev,
            slope: cell.slope,
            imperv: cell.imperv,
            flowAcc: Math.round(cell.flowAcc),
            drainDist: cell.drainDist,
            ...(useRoad && bestRoad ? { road: bestRoad } : {}),
          });
        });
        map.on("mouseenter", ["flood-cells", "simulated-road-risk", "hotspot-points", "manhole-points"], () => {
          if (map) map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", ["flood-cells", "simulated-road-risk", "hotspot-points", "manhole-points"], () => {
          if (map) map.getCanvas().style.cursor = "grab";
        });

        map.on("error", () => {
          errorCount += 1;
          if (errorCount >= 4) setMapError(true);
        });
        setMapReady(true);
      });
    }).catch(() => {
      if (!disposed) setMapError(true);
    });

    return () => {
      disposed = true;
      setMapReady(false);
      mapRef.current = null;
      map?.remove();
    };
  }, [terrain.city.id, terrain.city.center, retry]);

  const updateData = useCallback(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.isStyleLoaded()) return;
    const source = (id: string) => map.getSource(id) as GeoJSONSource | undefined;
    const { bounds } = terrain;
    const halfLat = ((bounds.maxLat - bounds.minLat) / (GRID - 1)) * 0.43;
    const halfLng = ((bounds.maxLng - bounds.minLng) / (GRID - 1)) * 0.43;

    const terrainFeatures: Feature<Geometry, Record<string, number | string>>[] = [];
    const floodFeatures: Feature<Geometry, Record<string, number | string>>[] = [];
    const rainFeatures: Feature<Geometry, Record<string, number | string>>[] = [];
    const elevations = terrain.cells.map((cell) => cell.elev);
    const minElevation = Math.min(...elevations);
    const maxElevation = Math.max(...elevations);
    for (const cell of terrain.cells) {
      const elevation = maxElevation === minElevation ? 0 : ((cell.elev - minElevation) / (maxElevation - minElevation)) * 15;
      terrainFeatures.push(polygonFeature(cell, halfLat, halfLng, { elevation }));
      if (step) {
        const depth = Math.round((step.mlDepth[cell.id] ?? 0) * 10) / 10;
        const risk = riskOf(depth);
        if (depth > 1) floodFeatures.push(polygonFeature(cell, halfLat, halfLng, { cell: cell.id, depth, risk, riskIndex: RISK_LEVELS.indexOf(risk) }));
      }
      if (rainfall > 0) {
        rainFeatures.push(polygonFeature(cell, halfLat, halfLng, { opacity: Math.min(0.2, 0.04 + rainfall / 1800) }));
      }
    }

    const roadFeatures = terrain.roads.map((road) => {
      const coordinates = road.cells.flatMap((id) => {
        const cell = terrain.cells[id];
        return cell ? [[cell.lng, cell.lat] as Position] : [];
      });
      const depth = step ? roadDepth(road, step.mlDepth) : 0;
      return lineFeature(coordinates, { name: road.name, depth, risk: riskOf(depth), importance: road.importance });
    });
    const drainFeatures = terrain.drains.flatMap((drain) => {
      if (drain.downstream < 0) return [];
      const downstream = terrain.drains[drain.downstream];
      if (!downstream) return [];
      return [lineFeature([[drain.lng, drain.lat], [downstream.lng, downstream.lat]], {
        utilization: step?.drains[drain.id]?.utilization ?? 0,
        name: drain.name,
      })];
    });
    const manholeFeatures = terrain.drains.map((drain) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [drain.lng, drain.lat] },
      properties: { kind: drain.kind, utilization: step?.drains[drain.id]?.utilization ?? 0, name: drain.name },
    }));
    const hotspotFeatures = (layers.hotspots ? hotspots.slice(0, 6) : []).map((hotspot, index) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [hotspot.lng, hotspot.lat] },
      properties: { number: String(index + 1), name: hotspot.name, depth: hotspot.depth },
    }));
    const routeFeatures = [
      ...(altRoute ? [{ route: altRoute, routeType: "fastest" }] : []),
      ...(route ? [{ route, routeType: "safest" }] : []),
    ].flatMap(({ route: currentRoute, routeType }) => {
      const coordinates = currentRoute.nodes.flatMap((nodeId) => {
        const node = terrain.roadNodes[nodeId];
        return node ? [[node.lng, node.lat] as Position] : [];
      });
      return coordinates.length > 1 ? [lineFeature(coordinates, { routeType })] : [];
    });

    source("terrain")?.setData(collection(terrainFeatures));
    source("flood")?.setData(collection(floodFeatures));
    source("rainfall")?.setData(collection(rainFeatures));
    source("roads")?.setData(collection(roadFeatures));
    source("drains")?.setData(collection(drainFeatures));
    source("manholes")?.setData({ type: "FeatureCollection", features: manholeFeatures });
    source("hotspots")?.setData({ type: "FeatureCollection", features: hotspotFeatures });
    source("routes")?.setData(collection(routeFeatures));

    const setVisibility = (layer: string, visible: boolean) => {
      if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", visible ? "visible" : "none");
    };
    setVisibility("terrain-cells", layers.elevation);
    setVisibility("rainfall-cells", layers.rainfall);
    setVisibility("flood-cells", layers.flood && Boolean(step));
    setVisibility("simulated-road-risk", layers.roads);
    setVisibility("drainage-pipes", layers.drainage);
    setVisibility("manhole-points", layers.manholes);
    setVisibility("hotspot-points", layers.hotspots);
    setVisibility("hotspot-labels", layers.hotspots);
    setVisibility("fastest-route", layers.route && Boolean(altRoute));
    setVisibility("recommended-route", layers.route && Boolean(route));
    if (map.getLayer("flood-cells")) {
      map.setFilter("flood-cells", ["all", [">=", ["get", "riskIndex"], minRisk], [">", ["get", "depth"], 1]]);
    }
  }, [terrain, step, layers, hotspots, route, altRoute, minRisk, rainfall, mapReady]);

  useEffect(() => {
    updateData();
  }, [updateData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.fitBounds(
      [[terrain.bounds.minLng, terrain.bounds.minLat], [terrain.bounds.maxLng, terrain.bounds.maxLat]],
      { padding: 28, duration: 700, maxZoom: 15.5 },
    );
  }, [terrain]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus || focus === focusRef.current) return;
    focusRef.current = focus;
    map.flyTo({ center: [focus.lng, focus.lat], zoom: 16.2, duration: 850 });
  }, [focus]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-sm bg-background">
      <div ref={hostRef} className="absolute inset-0" aria-label={`${terrain.city.name} interactive street map`} />
      <div className="pointer-events-none absolute top-3 left-3 z-10 flex flex-col gap-1">
        <span className="w-fit rounded-sm border border-border bg-background/90 px-2 py-1 font-mono text-[10px] text-accent">
          PROTOTYPE / SIMULATED DATA
        </span>
        <span className="w-fit rounded-sm border border-border bg-background/90 px-2 py-1 font-mono text-[9px] text-muted-foreground">
          {terrain.city.name.toUpperCase()} STUDY AREA · {coordinates[0].toFixed(4)}, {coordinates[1].toFixed(4)}
        </span>
      </div>
      <div className="pointer-events-none absolute top-3 right-3 z-10 max-w-52 rounded-sm border border-border bg-background/90 px-2 py-1 text-right font-mono text-[9px] text-muted-foreground">
        FLOOD ZONES & ROUTES ARE SIMULATED · NOT SNAPPED TO STREETS
      </div>
      {mapError && (
        <div className="absolute inset-x-3 top-20 z-20 flex items-center justify-between gap-3 border border-border bg-background/95 px-3 py-2 text-xs shadow-lg">
          <span>Street tiles are unavailable. Simulated flood layers remain available.</span>
          <button className="text-primary underline underline-offset-2" onClick={() => setRetry((value) => value + 1)}>
            Retry map
          </button>
        </div>
      )}
      {!mapReady && !mapError && (
        <div className="pointer-events-none absolute right-3 bottom-3 z-10 rounded-sm border border-border bg-background/90 px-2 py-1 font-mono text-[9px] text-muted-foreground">
          CONNECTING TO STREET MAP…
        </div>
      )}
    </div>
  );
}