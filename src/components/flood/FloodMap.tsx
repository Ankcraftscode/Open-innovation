import { useEffect, useRef, useState, useCallback } from "react";
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
  onSelect: (s: MapSelection) => void;
}

export function FloodMap({
  terrain,
  step,
  layers,
  hotspots,
  route,
  altRoute,
  focus,
  minRisk,
  rainfall,
  onSelect,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!focus) return;
    const { bounds } = terrain;
    const fx = (focus.lng - bounds.minLng) / (bounds.maxLng - bounds.minLng);
    const fy = (bounds.maxLat - focus.lat) / (bounds.maxLat - bounds.minLat);
    const scale = 2.6;
    setView({
      scale,
      x: size.w / 2 - fx * size.w * scale,
      y: size.h / 2 - fy * size.h * scale,
    });
  }, [focus, terrain, size.w, size.h]);

  const project = useCallback(
    (lat: number, lng: number) => {
      const { bounds } = terrain;
      const fx = (lng - bounds.minLng) / (bounds.maxLng - bounds.minLng);
      const fy = (bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat);
      return [fx * size.w * view.scale + view.x, fy * size.h * view.scale + view.y] as const;
    },
    [terrain, size, view],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    // base
    ctx.fillStyle = "#0f151c";
    ctx.fillRect(0, 0, size.w, size.h);

    const cw = (size.w * view.scale) / GRID + 1;
    const ch = (size.h * view.scale) / GRID + 1;
    const elevs = terrain.cells.map((c) => c.elev);
    const lo = Math.min(...elevs);
    const hi = Math.max(...elevs);

    for (const cell of terrain.cells) {
      const [x, y] = project(cell.lat, cell.lng);
      if (x < -cw || y < -ch || x > size.w || y > size.h) continue;
      if (layers.elevation) {
        const t = (cell.elev - lo) / (hi - lo || 1);
        const l = 14 + t * 30;
        ctx.fillStyle = `hsl(210 18% ${l}%)`;
        ctx.fillRect(x, y, cw, ch);
      }
      if (layers.rainfall) {
        const t = Math.min(1, rainfall / 130);
        ctx.fillStyle = `rgba(60,130,220,${0.05 + t * 0.18})`;
        ctx.fillRect(x, y, cw, ch);
      }
      if (layers.flood && step) {
        const d = step.mlDepth[cell.id] ?? 0;
        const r = riskOf(d);
        const idx = ["SAFE", "LOW", "MODERATE", "HIGH", "SEVERE"].indexOf(r);
        if (idx >= minRisk && d > 1) {
          ctx.fillStyle = RISK_COLOR[r];
          ctx.globalAlpha = Math.min(0.85, 0.25 + d / 60);
          ctx.fillRect(x, y, cw, ch);
          ctx.globalAlpha = 1;
        }
      }
    }

    // drainage pipes
    if (layers.drainage) {
      ctx.lineWidth = Math.max(1, 1.6 * view.scale);
      for (const d of terrain.drains) {
        if (d.downstream < 0) continue;
        const t = terrain.drains[d.downstream];
        if (!t) continue;
        const [x1, y1] = project(d.lat, d.lng);
        const [x2, y2] = project(t.lat, t.lng);
        const util = step?.drains[d.id]?.utilization ?? 0;
        ctx.strokeStyle =
          util > 1.2 ? "#d63a4a" : util > 1 ? "#e8722c" : util > 0.8 ? "#e0b021" : "#4a7f97";
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // roads
    if (layers.roads) {
      for (const r of terrain.roads) {
        const a = terrain.roadNodes[r.a];
        const b = terrain.roadNodes[r.b];
        if (!a || !b) continue;
        const [x1, y1] = project(a.lat, a.lng);
        const [x2, y2] = project(b.lat, b.lng);
        const d = step ? roadDepth(r, step.mlDepth) : 0;
        ctx.strokeStyle = step && d > 5 ? RISK_COLOR[riskOf(d)] : "rgba(190,205,220,0.42)";
        ctx.lineWidth = (r.importance === 3 ? 3.4 : r.importance === 2 ? 2.4 : 1.6) * Math.max(0.7, view.scale * 0.8);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }

    // routes
    const drawRoute = (rt: RouteResult | null, color: string, dash: number[]) => {
      if (!rt) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 4.5 * Math.max(0.8, view.scale * 0.8);
      ctx.setLineDash(dash);
      ctx.lineJoin = "round";
      ctx.beginPath();
      rt.nodes.forEach((n, i) => {
        const nd = terrain.roadNodes[n];
        if (!nd) return;
        const [x, y] = project(nd.lat, nd.lng);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    };
    if (layers.route) {
      drawRoute(altRoute, "rgba(230,120,60,0.75)", [10, 6]);
      drawRoute(route, "#38e1c8", []);
    }

    // manholes / drain nodes
    if (layers.manholes) {
      for (const d of terrain.drains) {
        const [x, y] = project(d.lat, d.lng);
        const util = step?.drains[d.id]?.utilization ?? 0;
        const rad = d.kind === "outfall" ? 6 : 4;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fillStyle =
          util > 1.2 ? "#d63a4a" : util > 1 ? "#e8722c" : util > 0.8 ? "#e0b021" : "#5fd0e8";
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // hotspots
    if (layers.hotspots) {
      hotspots.slice(0, 6).forEach((h, i) => {
        const [x, y] = project(h.lat, h.lng);
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.strokeStyle = "#ffd166";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "#ffd166";
        ctx.font = "bold 11px 'IBM Plex Mono', monospace";
        ctx.fillText(String(i + 1), x - 3, y + 4);
      });
    }
  }, [terrain, step, layers, hotspots, route, altRoute, project, size, view, minRisk, rainfall]);

  const pick = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const fx = (px - view.x) / (size.w * view.scale);
    const fy = (py - view.y) / (size.h * view.scale);
    const { bounds } = terrain;
    const lng = bounds.minLng + fx * (bounds.maxLng - bounds.minLng);
    const lat = bounds.maxLat - fy * (bounds.maxLat - bounds.minLat);
    const col = Math.round(fx * (GRID - 1));
    const row = Math.round(fy * (GRID - 1));
    if (row < 0 || col < 0 || row >= GRID || col >= GRID) return;
    const cell = terrain.cells[row * GRID + col];
    if (!cell) return;

    // nearest road within tolerance
    let bestRoad: RoadSeg | undefined;
    let bestD = Infinity;
    for (const r of terrain.roads) {
      for (const c of r.cells) {
        const cc = terrain.cells[c];
        if (!cc) continue;
        const dd = Math.hypot(cc.lat - lat, cc.lng - lng);
        if (dd < bestD) {
          bestD = dd;
          bestRoad = r;
        }
      }
    }
    const tol = (bounds.maxLat - bounds.minLat) / GRID / view.scale;
    const useRoad = bestRoad && bestD < tol * 1.5;
    const drain = terrain.drains[cell.drainId];
    const depth = step
      ? useRoad && bestRoad
        ? roadDepth(bestRoad, step.mlDepth)
        : Math.round((step.mlDepth[cell.id] ?? 0) * 10) / 10
      : 0;
    onSelect({
      kind: useRoad ? "road" : "cell",
      name: useRoad && bestRoad ? bestRoad.name : `Grid Cell ${cell.id}`,
      cell: cell.id,
      depth,
      drainUtil: step?.drains[cell.drainId]?.utilization ?? 0,
      drainName: drain?.name ?? "—",
      elev: cell.elev,
      slope: cell.slope,
      imperv: cell.imperv,
      flowAcc: Math.round(cell.flowAcc),
      drainDist: cell.drainDist,
      ...(useRoad && bestRoad ? { road: bestRoad } : {}),
    });
  };

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden rounded-md">
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h }}
        className="cursor-crosshair select-none"
        onMouseDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y };
        }}
        onMouseMove={(e) => {
          if (!drag.current) return;
          setView((v) => ({
            ...v,
            x: drag.current!.ox + (e.clientX - drag.current!.x),
            y: drag.current!.oy + (e.clientY - drag.current!.y),
          }));
        }}
        onMouseUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) pick(e);
        }}
        onMouseLeave={() => (drag.current = null)}
        onWheel={(e) => {
          const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
          setView((v) => {
            const scale = Math.min(8, Math.max(1, v.scale * f));
            const k = scale / v.scale;
            const rect = canvasRef.current!.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;
            return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
          });
        }}
      />
      <div className="pointer-events-none absolute inset-0 scanline opacity-40" />
      <div className="absolute top-2 left-2 flex gap-2">
        <span className="label-xs rounded bg-background/80 px-2 py-1 text-accent">
          Prototype / Simulated Data
        </span>
      </div>
      <div className="absolute right-2 bottom-2 flex flex-col gap-1">
        <button
          className="panel h-7 w-7 text-sm"
          onClick={() => setView((v) => ({ ...v, scale: Math.min(8, v.scale * 1.3) }))}
        >
          +
        </button>
        <button
          className="panel h-7 w-7 text-sm"
          onClick={() => setView((v) => ({ ...v, scale: Math.max(1, v.scale / 1.3) }))}
        >
          −
        </button>
        <button
          className="panel h-7 w-7 text-[9px]"
          onClick={() => setView({ scale: 1, x: 0, y: 0 })}
        >
          FIT
        </button>
      </div>
    </div>
  );
}
