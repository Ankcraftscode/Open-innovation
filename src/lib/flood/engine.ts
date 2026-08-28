/**
 * Urban Flood Nowcasting System — coupled rainfall / terrain / drainage / ML engine.
 * All data is PROTOTYPE / SIMULATED. Deterministic per city seed.
 */

export const HORIZONS = [0, 30, 60, 90, 120, 180] as const;
export type Horizon = (typeof HORIZONS)[number];

export type LandUse = "concrete" | "asphalt" | "buildings" | "grass" | "soil";

export const RUNOFF_COEFF: Record<LandUse, number> = {
  concrete: 0.9,
  asphalt: 0.85,
  buildings: 0.95,
  grass: 0.3,
  soil: 0.2,
};

export const RISK_LEVELS = ["SAFE", "LOW", "MODERATE", "HIGH", "SEVERE"] as const;
export type Risk = (typeof RISK_LEVELS)[number];

export function riskOf(depthCm: number): Risk {
  if (depthCm < 5) return "SAFE";
  if (depthCm < 15) return "LOW";
  if (depthCm < 30) return "MODERATE";
  if (depthCm < 50) return "HIGH";
  return "SEVERE";
}

export const RISK_COLOR: Record<Risk, string> = {
  SAFE: "#1c4b57",
  LOW: "#2f9e8f",
  MODERATE: "#e0b021",
  HIGH: "#e8722c",
  SEVERE: "#d63a4a",
};

/* ------------------------------------------------------------------ cities */

export type CityId = "delhi" | "mumbai" | "chennai";

export interface City {
  id: CityId;
  name: string;
  ward: string;
  center: [number, number];
  areaKm2: number;
  seed: number;
  baseElev: number;
  imperviousBias: number;
  drainAge: string;
}

export const CITIES: Record<CityId, City> = {
  delhi: {
    id: "delhi",
    name: "Delhi",
    ward: "Minto Bridge – Connaught Place corridor",
    center: [28.6289, 77.2185],
    areaKm2: 4.0,
    seed: 8112,
    baseElev: 214,
    imperviousBias: 0.06,
    drainAge: "Mixed 1960s–2005 brick & RCC box drains",
  },
  mumbai: {
    id: "mumbai",
    name: "Mumbai",
    ward: "Hindmata – Dadar TT catchment",
    center: [19.0176, 72.8419],
    areaKm2: 3.2,
    seed: 4417,
    baseElev: 7,
    imperviousBias: 0.12,
    drainAge: "Tidal-locked BRIMSTOWAD-era outfalls",
  },
  chennai: {
    id: "chennai",
    name: "Chennai",
    ward: "Velachery – Taramani basin",
    center: [12.9784, 80.2205],
    areaKm2: 4.5,
    seed: 9031,
    baseElev: 9,
    imperviousBias: 0.02,
    drainAge: "Macro-drains discharging to Pallikaranai marsh",
  },
};

/* ---------------------------------------------------------------- rainfall */

export type ScenarioId = "light" | "moderate" | "heavy" | "extreme" | "custom";

export const SCENARIOS: Record<Exclude<ScenarioId, "custom">, { label: string; peak: number }> = {
  light: { label: "Light Rain", peak: 12 },
  moderate: { label: "Moderate Rain", peak: 38 },
  heavy: { label: "Heavy Rain", peak: 72 },
  extreme: { label: "Extreme Rain", peak: 118 },
};

/** Nowcast curve: rises to a peak around +90 min then decays. */
export function rainfallNowcast(peak: number): { t: Horizon; mm: number }[] {
  const shape = [0.56, 0.78, 1.0, 1.11, 0.83, 0.49];
  return HORIZONS.map((t, i) => ({ t, mm: Math.round(peak * shape[i] * 10) / 10 }));
}

/* ------------------------------------------------------------------- utils */

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/* ------------------------------------------------------------------ terrain */

export const GRID = 44; // 44 x 44 cells

export interface Cell {
  id: number;
  row: number;
  col: number;
  lat: number;
  lng: number;
  elev: number;
  slope: number;
  flowDir: number; // downstream cell id, -1 = sink/outlet
  flowAcc: number;
  imperv: number; // 0..1
  landuse: LandUse;
  drainId: number;
  drainDist: number; // metres
  road: boolean;
}

export interface DrainNode {
  id: number;
  name: string;
  kind: "manhole" | "inlet" | "junction" | "outfall";
  cell: number;
  lat: number;
  lng: number;
  invert: number;
  downstream: number; // node id or -1
  pipe: { diameter: number; length: number; slope: number; n: number };
  capacity: number; // m3/s (Manning)
  blockage: number; // 0..1
}

export interface RoadSeg {
  id: number;
  name: string;
  a: number; // road node index
  b: number;
  cells: number[];
  lengthM: number;
  importance: number; // 1..3
}

export interface RoadNode {
  id: number;
  name: string;
  lat: number;
  lng: number;
  cell: number;
}

export interface Terrain {
  city: City;
  cells: Cell[];
  drains: DrainNode[];
  roadNodes: RoadNode[];
  roads: RoadSeg[];
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  cellAreaM2: number;
}

/** Manning discharge capacity for a circular pipe flowing full. */
export function manningCapacity(d: number, slope: number, n: number) {
  const A = (Math.PI * d * d) / 4;
  const R = d / 4;
  return (1 / n) * A * Math.pow(R, 2 / 3) * Math.sqrt(slope);
}

const NAMES_A = [
  "Nehru",
  "Marina",
  "Kamaraj",
  "Sion",
  "Minto",
  "Lake",
  "Anna",
  "Ring",
  "Baker",
  "Gandhi",
  "Tank",
  "Salt",
];
const NAMES_B = ["Road", "Marg", "Avenue", "Cross", "Link", "Street"];

export function buildTerrain(city: City): Terrain {
  const rnd = mulberry(city.seed);
  const span = Math.sqrt(city.areaKm2); // km
  const dLat = span / 111;
  const dLng = span / (111 * Math.cos((city.center[0] * Math.PI) / 180));
  const bounds = {
    minLat: city.center[0] - dLat / 2,
    maxLat: city.center[0] + dLat / 2,
    minLng: city.center[1] - dLng / 2,
    maxLng: city.center[1] + dLng / 2,
  };
  const cellM = (span * 1000) / GRID;
  const cellAreaM2 = cellM * cellM;

  // --- elevation field: regional tilt + basin + ridges + noise
  const p = Array.from({ length: 8 }, () => rnd() * Math.PI * 2);
  const bx = 0.3 + rnd() * 0.4;
  const by = 0.3 + rnd() * 0.4;
  const raw: number[] = [];
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const x = c / (GRID - 1);
      const y = r / (GRID - 1);
      const basin = -6.5 * Math.exp(-(((x - bx) ** 2 + (y - by) ** 2) / 0.045));
      const channel = -3.2 * Math.exp(-(((y - (0.35 + 0.25 * Math.sin(x * 3 + p[0]))) ** 2) / 0.004));
      const ridges =
        1.9 * Math.sin(x * 6.1 + p[1]) +
        1.4 * Math.cos(y * 5.3 + p[2]) +
        0.8 * Math.sin((x + y) * 9.7 + p[3]);
      const tilt = 4.5 * (1 - y) + 2.0 * x;
      raw.push(city.baseElev + tilt + ridges + basin + channel + (rnd() - 0.5) * 0.35);
    }
  }

  const cells: Cell[] = [];
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const id = r * GRID + c;
      const isRoad = r % 6 === 0 || c % 7 === 0;
      const u = rnd();
      let landuse: LandUse;
      if (isRoad) landuse = "asphalt";
      else if (u < 0.42 + city.imperviousBias) landuse = "buildings";
      else if (u < 0.72) landuse = "concrete";
      else if (u < 0.9) landuse = "grass";
      else landuse = "soil";
      const imperv =
        landuse === "buildings"
          ? 0.9 + rnd() * 0.08
          : landuse === "asphalt"
            ? 0.85 + rnd() * 0.1
            : landuse === "concrete"
              ? 0.75 + rnd() * 0.15
              : landuse === "grass"
                ? 0.15 + rnd() * 0.2
                : 0.05 + rnd() * 0.15;
      cells.push({
        id,
        row: r,
        col: c,
        lat: bounds.maxLat - (r / (GRID - 1)) * dLat,
        lng: bounds.minLng + (c / (GRID - 1)) * dLng,
        elev: Math.round(raw[id] * 100) / 100,
        slope: 0,
        flowDir: -1,
        flowAcc: 1,
        imperv: clamp(imperv, 0.03, 0.98),
        landuse,
        drainId: -1,
        drainDist: 0,
        road: isRoad,
      });
    }
  }

  // --- D8 flow direction + slope
  for (const cell of cells) {
    let best = -1;
    let bestDrop = 0;
    let maxDrop = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const r = cell.row + dr;
        const c = cell.col + dc;
        if (r < 0 || c < 0 || r >= GRID || c >= GRID) continue;
        const nb = cells[r * GRID + c];
        const dist = cellM * Math.hypot(dr, dc);
        const drop = (cell.elev - nb.elev) / dist;
        if (drop > maxDrop) maxDrop = drop;
        if (drop > bestDrop) {
          bestDrop = drop;
          best = nb.id;
        }
      }
    }
    cell.flowDir = best;
    cell.slope = Math.round(maxDrop * 1000) / 10; // percent
  }

  // --- flow accumulation (process high → low)
  const order = [...cells].sort((a, b) => b.elev - a.elev);
  for (const cell of order) {
    if (cell.flowDir >= 0) cells[cell.flowDir].flowAcc += cell.flowAcc;
  }

  // --- drainage network: nodes on a lattice, biased to local lows
  const drains: DrainNode[] = [];
  const DN = 7;
  for (let r = 0; r < DN; r++) {
    for (let c = 0; c < DN; c++) {
      const gr = Math.min(GRID - 1, Math.round(((r + 0.5) / DN) * GRID));
      const gc = Math.min(GRID - 1, Math.round(((c + 0.5) / DN) * GRID));
      // snap to lowest cell in the 3x3 neighbourhood
      let target = cells[gr * GRID + gc];
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++) {
          const rr = clamp(gr + dr, 0, GRID - 1);
          const cc = clamp(gc + dc, 0, GRID - 1);
          if (cells[rr * GRID + cc].elev < target.elev) target = cells[rr * GRID + cc];
        }
      const id = drains.length;
      const diameter = 0.45 + rnd() * 1.15;
      const slope = 0.0012 + rnd() * 0.006;
      const n = 0.013 + rnd() * 0.006;
      const kind: DrainNode["kind"] =
        r === DN - 1 && c % 3 === 0 ? "outfall" : id % 5 === 0 ? "junction" : id % 2 ? "manhole" : "inlet";
      drains.push({
        id,
        name: `${kind === "outfall" ? "OUT" : kind === "junction" ? "JN" : "MH"}-${String(id + 1).padStart(2, "0")}`,
        kind,
        cell: target.id,
        lat: target.lat,
        lng: target.lng,
        invert: target.elev - (2 + rnd() * 1.5),
        downstream: -1,
        pipe: { diameter, length: 90 + rnd() * 220, slope, n },
        capacity: manningCapacity(diameter, slope, n),
        blockage: rnd() < 0.22 ? 0.2 + rnd() * 0.4 : rnd() * 0.12,
      });
    }
  }
  // connect each node to a lower downstream node (directed graph → outfalls)
  for (const d of drains) {
    if (d.kind === "outfall") continue;
    let best = -1;
    let bestScore = Infinity;
    for (const o of drains) {
      if (o.id === d.id) continue;
      const dist = Math.hypot(o.lat - d.lat, o.lng - d.lng);
      if (cells[o.cell].elev >= cells[d.cell].elev) continue;
      const score = dist * 1000 + (o.kind === "outfall" ? -0.4 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = o.id;
      }
    }
    d.downstream = best;
  }

  // --- nearest drain per cell
  for (const cell of cells) {
    let best = 0;
    let bestD = Infinity;
    for (const d of drains) {
      const dd = Math.hypot((cell.lat - d.lat) * 111000, (cell.lng - d.lng) * 105000);
      if (dd < bestD) {
        bestD = dd;
        best = d.id;
      }
    }
    cell.drainId = best;
    cell.drainDist = Math.round(bestD);
  }

  // --- road graph (lattice of intersections along road cells)
  const roadRows: number[] = [];
  for (let r = 0; r < GRID; r += 6) roadRows.push(r);
  const roadCols: number[] = [];
  for (let c = 0; c < GRID; c += 7) roadCols.push(c);

  const roadNodes: RoadNode[] = [];
  const nodeIndex = new Map<string, number>();
  roadRows.forEach((r, ri) =>
    roadCols.forEach((c, ci) => {
      const cell = cells[r * GRID + c];
      const id = roadNodes.length;
      nodeIndex.set(`${ri}:${ci}`, id);
      roadNodes.push({
        id,
        name: `Jn ${String.fromCharCode(65 + ri)}${ci + 1}`,
        lat: cell.lat,
        lng: cell.lng,
        cell: cell.id,
      });
    }),
  );

  const roads: RoadSeg[] = [];
  const cellsBetween = (c1: Cell, c2: Cell) => {
    const out: number[] = [];
    const steps = Math.max(Math.abs(c1.row - c2.row), Math.abs(c1.col - c2.col));
    for (let s = 0; s <= steps; s++) {
      const r = Math.round(c1.row + ((c2.row - c1.row) * s) / steps);
      const c = Math.round(c1.col + ((c2.col - c1.col) * s) / steps);
      out.push(r * GRID + c);
    }
    return out;
  };
  const nameFor = (i: number) => `${NAMES_A[i % NAMES_A.length]} ${NAMES_B[(i * 3) % NAMES_B.length]}`;

  roadRows.forEach((r, ri) =>
    roadCols.forEach((c, ci) => {
      const a = nodeIndex.get(`${ri}:${ci}`)!;
      const right = nodeIndex.get(`${ri}:${ci + 1}`);
      const down = nodeIndex.get(`${ri + 1}:${ci}`);
      for (const b of [right, down]) {
        if (b === undefined) continue;
        const ca = cells[roadNodes[a].cell];
        const cb = cells[roadNodes[b].cell];
        const cs = cellsBetween(ca, cb);
        roads.push({
          id: roads.length,
          name: nameFor(roads.length),
          a,
          b,
          cells: cs,
          lengthM: Math.round((cs.length - 1) * cellM),
          importance: 1 + ((r + c) % 3),
        });
      }
    }),
  );

  return { city, cells, drains, roadNodes, roads, bounds, cellAreaM2 };
}

/* ---------------------------------------------------- physics flood engine */

export interface DrainState {
  id: number;
  inflow: number; // m3/s
  capacity: number; // effective m3/s
  utilization: number; // fraction
  overflow: number; // m3/s returned to surface
  waterLevel: number; // m above invert
  status: "Normal" | "Near capacity" | "Overloaded" | "Severe surcharge";
}

export interface StepResult {
  t: Horizon;
  rainfall: number;
  depth: Float32Array; // cm per cell (physics)
  mlDepth: Float32Array; // cm per cell (XGBoost surrogate)
  drains: DrainState[];
  totalRunoffM3: number;
}

function statusOf(u: number): DrainState["status"] {
  if (u < 0.8) return "Normal";
  if (u <= 1.0) return "Near capacity";
  if (u <= 1.2) return "Overloaded";
  return "Severe surcharge";
}

/** One physics timestep. Mutates nothing; returns new depth in cm. */
export function simulateStep(
  terrain: Terrain,
  prev: Float32Array,
  rainMm: number,
  dtMin: number,
  blockageBoost = 0,
): { depth: Float32Array; drains: DrainState[]; runoff: number } {
  const { cells, drains, cellAreaM2 } = terrain;
  const dtH = dtMin / 60;
  const dtS = dtMin * 60;
  const depth = Float32Array.from(prev); // cm

  // 1. rainfall → runoff (cm of water added on the cell)
  let totalRunoff = 0;
  const inflowByDrain = new Float64Array(drains.length);
  for (const cell of cells) {
    const C = RUNOFF_COEFF[cell.landuse] * (0.65 + 0.35 * cell.imperv);
    const runoffCm = rainMm * dtH * C * 0.1; // mm→cm
    depth[cell.id] += runoffCm;
    const volume = (runoffCm / 100) * cellAreaM2; // m3
    totalRunoff += volume;
    // capture efficiency toward the inlet falls off with distance
    const capture = clamp(1 - cell.drainDist / 320, 0.15, 1);
    inflowByDrain[cell.drainId] += (volume * capture) / dtS; // m3/s
  }

  // 2. drainage hydraulics (Manning capacity + blockage), routed downstream
  const states: DrainState[] = drains.map((d) => {
    const blockage = clamp(d.blockage + blockageBoost, 0, 0.95);
    const capacity = d.capacity * (1 - blockage);
    return {
      id: d.id,
      inflow: inflowByDrain[d.id],
      capacity,
      utilization: 0,
      overflow: 0,
      waterLevel: 0,
      status: "Normal",
    };
  });
  // route accepted flow downstream (upstream-first by elevation)
  const dorder = [...drains].sort((a, b) => cells[b.cell].elev - cells[a.cell].elev);
  for (const d of dorder) {
    const s = states[d.id];
    const accepted = Math.min(s.inflow, s.capacity);
    if (d.downstream >= 0) states[d.downstream].inflow += accepted * 0.85;
  }
  for (const d of drains) {
    const s = states[d.id];
    s.utilization = s.capacity > 0 ? s.inflow / s.capacity : 9;
    s.overflow = Math.max(0, s.inflow - s.capacity);
    s.waterLevel = Math.round(Math.min(4.5, s.utilization * 2.2) * 100) / 100;
    s.status = statusOf(s.utilization);
  }

  // 3. drainage removal from the surface + surcharge back onto the surface
  const cellsByDrain = new Map<number, Cell[]>();
  for (const cell of cells) {
    const arr = cellsByDrain.get(cell.drainId) ?? [];
    arr.push(cell);
    cellsByDrain.set(cell.drainId, arr);
  }
  for (const [drainId, group] of cellsByDrain) {
    const s = states[drainId];
    const removedM3 = Math.min(s.inflow, s.capacity) * dtS;
    const surchargeM3 = s.overflow * dtS;
    // removal proportional to each cell's contribution/capture
    const weights = group.map((c) => clamp(1 - c.drainDist / 320, 0.15, 1) * Math.max(depth[c.id], 0.01));
    const wsum = weights.reduce((a, b) => a + b, 0) || 1;
    // surcharge pools in the lowest cells near the node
    const low = [...group].sort((a, b) => a.elev - b.elev).slice(0, Math.max(3, Math.ceil(group.length * 0.18)));
    group.forEach((c, i) => {
      const rem = ((removedM3 * weights[i]) / wsum / cellAreaM2) * 100;
      depth[c.id] = Math.max(0, depth[c.id] - rem);
    });
    const perCell = (surchargeM3 / low.length / cellAreaM2) * 100;
    for (const c of low) depth[c.id] += perCell;
  }

  // 4. 2D surface routing along D8 (several sub-passes)
  for (let pass = 0; pass < 3; pass++) {
    const moved = new Float32Array(cells.length);
    for (const cell of cells) {
      if (cell.flowDir < 0) continue;
      const d = depth[cell.id];
      if (d <= 0.4) continue;
      const grad = clamp(cell.slope / 4, 0.05, 0.85);
      const transfer = d * grad * 0.45;
      moved[cell.id] -= transfer;
      moved[cell.flowDir] += transfer;
    }
    for (let i = 0; i < depth.length; i++) depth[i] = Math.max(0, depth[i] + moved[i]);
  }

  // 5. infiltration / evaporation losses on pervious ground
  for (const cell of cells) {
    const loss = (1 - cell.imperv) * 1.6 * dtH + 0.25 * dtH;
    depth[cell.id] = Math.max(0, depth[cell.id] - loss);
  }

  return { depth, drains: states, runoff: totalRunoff };
}

/* -------------------------------------------------- ML: XGBoost surrogate */

export const FEATURES = [
  "rainfall",
  "rainfall_15min",
  "rainfall_30min",
  "rainfall_60min",
  "forecast_rainfall",
  "elevation_rel",
  "slope",
  "flow_accumulation",
  "imperviousness",
  "drain_capacity",
  "drain_utilization",
  "previous_depth",
  "distance_to_drain",
] as const;

interface TreeNode {
  leaf?: number;
  f?: number;
  thr?: number;
  l?: TreeNode;
  r?: TreeNode;
}

export interface Model {
  base: number;
  trees: TreeNode[];
  lr: number;
  metrics: { mae: number; rmse: number; r2: number; rows: number; storms: number; trees: number };
}

function buildTree(
  X: Float64Array[],
  g: Float64Array,
  idx: number[],
  depth: number,
  maxDepth: number,
  lambda: number,
): TreeNode {
  const mean = (ix: number[]) => ix.reduce((a, i) => a + g[i], 0) / (ix.length || 1);
  if (depth >= maxDepth || idx.length < 24) return { leaf: mean(idx) };
  let bestGain = 1e-6;
  let bestF = -1;
  let bestThr = 0;
  let bestL: number[] = [];
  let bestR: number[] = [];
  const sse = (ix: number[]) => {
    const m = mean(ix);
    return ix.reduce((a, i) => a + (g[i] - m) ** 2, 0);
  };
  const parent = sse(idx);
  for (let f = 0; f < X.length; f++) {
    const vals = idx.map((i) => X[f][i]).sort((a, b) => a - b);
    for (let q = 1; q <= 7; q++) {
      const thr = vals[Math.floor((vals.length * q) / 8)];
      const L: number[] = [];
      const R: number[] = [];
      for (const i of idx) (X[f][i] <= thr ? L : R).push(i);
      if (L.length < 12 || R.length < 12) continue;
      const gain = parent - sse(L) - sse(R) - lambda;
      if (gain > bestGain) {
        bestGain = gain;
        bestF = f;
        bestThr = thr;
        bestL = L;
        bestR = R;
      }
    }
  }
  if (bestF < 0) return { leaf: mean(idx) };
  return {
    f: bestF,
    thr: bestThr,
    l: buildTree(X, g, bestL, depth + 1, maxDepth, lambda),
    r: buildTree(X, g, bestR, depth + 1, maxDepth, lambda),
  };
}

function predictTree(t: TreeNode, x: number[]): number {
  let n = t;
  while (n.leaf === undefined) n = x[n.f!] <= n.thr! ? n.l! : n.r!;
  return n.leaf;
}

export function predict(model: Model, x: number[]): number {
  let v = model.base;
  for (const t of model.trees) v += model.lr * predictTree(t, x);
  return Math.max(0, v);
}

/** Physics-inspired synthetic label used by the training-data generator. */
function syntheticDepth(f: number[], rnd: () => number): number {
  const [rain, r15, r30, r60, fc, elevRel, slope, acc, imp, cap, util, prev, dist] = f;
  const supply = (0.42 * rain + 0.2 * r30 + 0.12 * r60 + 0.26 * fc) * (0.5 + 0.5 * imp);
  const topo = Math.exp(-slope / 1.6) * (0.55 + Math.log10(1 + acc) / 2.4) * Math.exp(-elevRel / 4.5);
  const drainage = Math.max(0, 1 - cap / 4.2) * 0.6 + clamp(util - 0.8, 0, 1.4) * 0.85;
  const reach = clamp(dist / 260, 0, 1) * 0.5;
  const d = supply * topo * (0.35 + drainage + reach) * 0.42 + prev * 0.55;
  return Math.max(0, d + (rnd() - 0.5) * 2.2);
}

/** Synthetic scenario generator + XGBoost-style gradient-boosted training. */
export function trainModel(seed = 7, storms = 90, perStorm = 34): { model: Model; sample: number[][] } {
  const rnd = mulberry(seed);
  const rows: number[][] = [];
  const stormOf: number[] = [];
  for (let s = 0; s < storms; s++) {
    const peak = 4 + rnd() * 135;
    for (let k = 0; k < perStorm; k++) {
      const rain = clamp(peak * (0.4 + rnd() * 0.9), 1, 190);
      const f = [
        rain,
        rain * (0.7 + rnd() * 0.5),
        rain * (0.6 + rnd() * 0.6),
        rain * (0.5 + rnd() * 0.7),
        rain * (0.6 + rnd() * 0.8),
        rnd() * 12, // elevation above basin floor (m)
        rnd() * 4.5, // slope %
        1 + rnd() * 900, // flow accumulation
        0.05 + rnd() * 0.93,
        0.4 + rnd() * 4.2, // drain capacity m3/s
        0.15 + rnd() * 1.6, // utilization
        rnd() * 14, // previous depth cm
        rnd() * 300, // distance to drain m
      ];
      rows.push([...f, syntheticDepth(f, rnd)]);
      stormOf.push(s);
    }
  }

  // storm-wise split (never split a single storm across train/test)
  const testStorm = (s: number) => s % 5 === 0;
  const trainIdx: number[] = [];
  const testIdx: number[] = [];
  rows.forEach((_, i) => (testStorm(stormOf[i]) ? testIdx : trainIdx).push(i));

  const nF = FEATURES.length;
  const X: Float64Array[] = Array.from({ length: nF }, (_, f) => Float64Array.from(rows.map((r) => r[f])));
  const y = Float64Array.from(rows.map((r) => r[nF]));
  const base = trainIdx.reduce((a, i) => a + y[i], 0) / trainIdx.length;
  const pred = new Float64Array(rows.length).fill(base);
  const resid = new Float64Array(rows.length);
  const lr = 0.22;
  const trees: TreeNode[] = [];
  for (let t = 0; t < 45; t++) {
    for (const i of trainIdx) resid[i] = y[i] - pred[i];
    const sub = trainIdx.filter(() => rnd() < 0.8);
    const tree = buildTree(X, resid, sub, 0, 4, 1.0);
    trees.push(tree);
    for (let i = 0; i < rows.length; i++) pred[i] += lr * predictTree(tree, rows[i]);
  }

  let se = 0;
  let ae = 0;
  const ymean = testIdx.reduce((a, i) => a + y[i], 0) / testIdx.length;
  let sst = 0;
  for (const i of testIdx) {
    const e = Math.max(0, pred[i]) - y[i];
    se += e * e;
    ae += Math.abs(e);
    sst += (y[i] - ymean) ** 2;
  }
  const model: Model = {
    base,
    trees,
    lr,
    metrics: {
      mae: Math.round((ae / testIdx.length) * 100) / 100,
      rmse: Math.round(Math.sqrt(se / testIdx.length) * 100) / 100,
      r2: Math.round((1 - se / sst) * 1000) / 1000,
      rows: rows.length,
      storms,
      trees: trees.length,
    },
  };
  return { model, sample: rows.slice(0, 6) };
}

/* ------------------------------------------------------- full nowcast run */

export interface RoadState {
  road: RoadSeg;
  depth: number;
  risk: Risk;
  drainUtil: number;
}

export interface Hotspot {
  key: string;
  name: string;
  lat: number;
  lng: number;
  cell: number;
  depth: number;
  peakT: Horizon;
  score: number;
  drainUtil: number;
  flowAcc: number;
}

export interface Alert {
  id: string;
  name: string;
  depth: number;
  minutes: number;
  drainUtil: number;
  risk: Risk;
  lat: number;
  lng: number;
}

export interface NowcastResult {
  steps: StepResult[];
  hotspots: Hotspot[];
  alerts: Alert[];
  model: Model;
  peakDepth: number;
  floodedRoads: number;
  criticalDrains: number;
  timeToCritical: number | null;
}

export function runNowcast(
  terrain: Terrain,
  peakRain: number,
  model: Model,
  blockageBoost = 0,
): NowcastResult {
  const { cells } = terrain;
  const nowcast = rainfallNowcast(peakRain);
  const minElev = Math.min(...cells.map((c) => c.elev));

  let depth = new Float32Array(cells.length);
  // warm-up: 20 minutes of the "now" intensity so t=0 is not bone dry
  depth = simulateStep(terrain, depth, nowcast[0].mm, 20, blockageBoost).depth;

  const steps: StepResult[] = [];
  let prevDepthArr = depth;
  for (let i = 0; i < HORIZONS.length; i++) {
    const dt = i === 0 ? 10 : HORIZONS[i] - HORIZONS[i - 1];
    const rain = nowcast[i].mm;
    const res = simulateStep(terrain, prevDepthArr, rain, dt, blockageBoost);
    const mlDepth = new Float32Array(cells.length);
    const fc = nowcast[Math.min(i + 1, HORIZONS.length - 1)].mm;
    for (const cell of cells) {
      const st = res.drains[cell.drainId];
      const x = [
        rain,
        rain * 0.95,
        rain * 0.9,
        i > 0 ? nowcast[i - 1].mm : rain * 0.8,
        fc,
        cell.elev - minElev,
        cell.slope,
        cell.flowAcc,
        cell.imperv,
        st.capacity,
        st.utilization,
        prevDepthArr[cell.id],
        cell.drainDist,
      ];
      // hybrid: ML surrogate blended with the physics solver state
      mlDepth[cell.id] = 0.55 * predict(model, x) + 0.45 * res.depth[cell.id];
    }
    steps.push({
      t: HORIZONS[i],
      rainfall: rain,
      depth: res.depth,
      mlDepth,
      drains: res.drains,
      totalRunoffM3: Math.round(res.runoff),
    });
    prevDepthArr = res.depth;
  }

  // hotspots over intersections + road midpoints
  const spots: Hotspot[] = [];
  const consider: { key: string; name: string; cell: number; imp: number }[] = [
    ...terrain.roadNodes.map((n) => ({ key: `jn-${n.id}`, name: n.name, cell: n.cell, imp: 2.2 })),
    ...terrain.roads.map((r) => ({
      key: `rd-${r.id}`,
      name: r.name,
      cell: r.cells[Math.floor(r.cells.length / 2)],
      imp: r.importance,
    })),
  ];
  for (const c of consider) {
    let peak = 0;
    let peakT: Horizon = 0;
    let duration = 0;
    for (const s of steps) {
      const d = s.mlDepth[c.cell];
      if (d > peak) {
        peak = d;
        peakT = s.t;
      }
      if (d > 15) duration += 30;
    }
    const cell = cells[c.cell];
    const util = steps[steps.length - 2].drains[cell.drainId].utilization;
    spots.push({
      key: c.key,
      name: c.name,
      lat: cell.lat,
      lng: cell.lng,
      cell: c.cell,
      depth: Math.round(peak * 10) / 10,
      peakT,
      drainUtil: util,
      flowAcc: cell.flowAcc,
      score:
        peak * 1.0 +
        duration * 0.09 +
        util * 12 +
        Math.log10(1 + cell.flowAcc) * 5 +
        c.imp * 3,
    });
  }
  spots.sort((a, b) => b.score - a.score);
  const hotspots = spots.slice(0, 8);

  // alerts + summary metrics
  const alerts: Alert[] = hotspots
    .filter((h) => h.depth >= 15)
    .slice(0, 5)
    .map((h) => {
      const cross = steps.find((s) => s.mlDepth[h.cell] >= 15);
      return {
        id: h.key,
        name: h.name,
        depth: h.depth,
        minutes: cross ? cross.t : h.peakT,
        drainUtil: h.drainUtil,
        risk: riskOf(h.depth),
        lat: h.lat,
        lng: h.lng,
      };
    });

  const peakStep = steps.reduce((a, b) =>
    Math.max(...b.mlDepth) > Math.max(...a.mlDepth) ? b : a,
  );
  const peakDepth = Math.round(Math.max(...peakStep.mlDepth) * 10) / 10;
  const floodedRoads = terrain.roads.filter(
    (r) => roadDepth(r, peakStep.mlDepth) >= 15,
  ).length;
  const criticalDrains = peakStep.drains.filter((d) => d.utilization > 1).length;
  const timeToCritical = alerts.length ? alerts[0].minutes : null;

  return { steps, hotspots, alerts, model, peakDepth, floodedRoads, criticalDrains, timeToCritical };
}

export function roadDepth(r: RoadSeg, depth: Float32Array) {
  let m = 0;
  for (const c of r.cells) m = Math.max(m, depth[c]);
  return Math.round(m * 10) / 10;
}

/* ------------------------------------------------------------ safe routing */

export type Vehicle = "ambulance" | "firetruck" | "police" | "transit" | "car";

export const VEHICLES: Record<Vehicle, { label: string; maxDepth: number; caution: number }> = {
  ambulance: { label: "Ambulance", maxDepth: 20, caution: 3.2 },
  firetruck: { label: "Fire Truck", maxDepth: 35, caution: 2.2 },
  police: { label: "Police", maxDepth: 28, caution: 2.6 },
  transit: { label: "Public Transport", maxDepth: 22, caution: 3.0 },
  car: { label: "Normal Vehicle", maxDepth: 25, caution: 2.8 },
};

export interface RouteResult {
  nodes: number[];
  distanceM: number;
  maxDepth: number;
  avgDepth: number;
  exposure: Risk;
  segments: RoadSeg[];
  blocked: boolean;
}

function dijkstra(
  terrain: Terrain,
  start: number,
  end: number,
  cost: (r: RoadSeg) => number,
): number[] | null {
  const adj = new Map<number, { to: number; r: RoadSeg }[]>();
  for (const r of terrain.roads) {
    (adj.get(r.a) ?? adj.set(r.a, []).get(r.a)!).push({ to: r.b, r });
    (adj.get(r.b) ?? adj.set(r.b, []).get(r.b)!).push({ to: r.a, r });
  }
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const visited = new Set<number>();
  dist.set(start, 0);
  while (true) {
    let u = -1;
    let best = Infinity;
    for (const [n, d] of dist) if (!visited.has(n) && d < best) ((best = d), (u = n));
    if (u === -1) break;
    if (u === end) break;
    visited.add(u);
    for (const e of adj.get(u) ?? []) {
      const c = cost(e.r);
      if (!isFinite(c)) continue;
      const nd = best + c;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, u);
      }
    }
  }
  if (!dist.has(end)) return null;
  const path = [end];
  let cur = end;
  while (cur !== start) {
    const p = prev.get(cur);
    if (p === undefined) return null;
    path.unshift(p);
    cur = p;
  }
  return path;
}

function pathToResult(terrain: Terrain, path: number[], depth: Float32Array): RouteResult {
  const segs: RoadSeg[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const r = terrain.roads.find(
      (x) =>
        (x.a === path[i] && x.b === path[i + 1]) || (x.b === path[i] && x.a === path[i + 1]),
    );
    if (r) segs.push(r);
  }
  const depths = segs.map((s) => roadDepth(s, depth));
  const maxDepth = depths.length ? Math.max(...depths) : 0;
  const avg = depths.length ? depths.reduce((a, b) => a + b, 0) / depths.length : 0;
  return {
    nodes: path,
    segments: segs,
    distanceM: segs.reduce((a, s) => a + s.lengthM, 0),
    maxDepth: Math.round(maxDepth * 10) / 10,
    avgDepth: Math.round(avg * 10) / 10,
    exposure: riskOf(maxDepth),
    blocked: false,
  };
}

export function computeRoutes(
  terrain: Terrain,
  depth: Float32Array,
  start: number,
  end: number,
  vehicle: Vehicle,
): { fastest: RouteResult | null; safest: RouteResult | null } {
  const v = VEHICLES[vehicle];
  const fastPath = dijkstra(terrain, start, end, (r) => r.lengthM);
  const safePath = dijkstra(terrain, start, end, (r) => {
    const d = roadDepth(r, depth);
    if (d > v.maxDepth) return Infinity;
    const penalty =
      d < 5 ? 1 : d < 15 ? 1.8 : d < 30 ? 4.5 * v.caution : 11 * v.caution;
    return r.lengthM * penalty;
  });
  return {
    fastest: fastPath ? pathToResult(terrain, fastPath, depth) : null,
    safest: safePath ? pathToResult(terrain, safePath, depth) : null,
  };
}

export const PIPELINE_STAGES = [
  "Loading rainfall nowcast (radar-equivalent synthetic field)",
  "Processing terrain — DEM, slope, D8 flow direction",
  "Calculating surface runoff by land-use coefficient",
  "Routing 2D surface water across the grid",
  "Building drainage graph — nodes & pipes",
  "Solving hydraulic capacity (Manning equation)",
  "Detecting drainage surcharge & blockages",
  "Training / running XGBoost flood-depth model",
  "Generating 0–3 h street-level flood map",
  "Computing flood-aware safe routes",
  "Generating emergency alerts",
];
