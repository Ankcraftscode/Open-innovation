import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FloodMap, type Layers, type MapSelection } from "@/components/flood/FloodMap";
import {
  CITIES,
  HORIZONS,
  PIPELINE_STAGES,
  RISK_COLOR,
  RISK_LEVELS,
  SCENARIOS,
  VEHICLES,
  buildTerrain,
  computeRoutes,
  rainfallNowcast,
  riskOf,
  roadDepth,
  runNowcast,
  trainModel,
  type CityId,
  type Model,
  type NowcastResult,
  type ScenarioId,
  type Vehicle,
} from "@/lib/flood/engine";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Urban Flood Nowcasting System — 0–3 Hour Street-Level Prototype" },
      {
        name: "description",
        content:
          "Coupled rainfall–terrain–drainage–ML nowcasting prototype for Delhi, Mumbai and Chennai: flood depth, drainage surcharge, hotspots and flood-safe emergency routing.",
      },
      { property: "og:title", content: "Urban Flood Nowcasting System" },
      {
        property: "og:description",
        content:
          "Street-level 0–3 hour urban flood nowcasting: rainfall → runoff → 2D flow → drainage hydraulics → XGBoost depth prediction → safe routes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

/* ------------------------------------------------------------------ atoms */

function Stat({ label, value, unit, tone }: { label: string; value: string | number; unit?: string; tone?: string }) {
  return (
    <div className="panel px-3 py-2">
      <div className="label-xs">{label}</div>
      <div className="font-mono text-lg leading-tight" style={tone ? { color: tone } : undefined}>
        {value}
        {unit ? <span className="ml-1 text-xs text-muted-foreground">{unit}</span> : null}
      </div>
    </div>
  );
}

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="display text-xs tracking-[0.18em] text-muted-foreground uppercase">{children}</h3>
      {right}
    </div>
  );
}

const tip = {
  contentStyle: {
    background: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    fontSize: 11,
    fontFamily: "var(--font-mono)",
  },
  labelStyle: { color: "var(--muted-foreground)" },
};

/* -------------------------------------------------------------- dashboard */

function Dashboard() {
  const [cityId, setCityId] = useState<CityId>("mumbai");
  const [scenario, setScenario] = useState<ScenarioId>("heavy");
  const [customRain, setCustomRain] = useState(72);
  const [blockage, setBlockage] = useState(0);
  const [timeIdx, setTimeIdx] = useState(2);
  const [minRisk, setMinRisk] = useState(0);
  const [vehicle, setVehicle] = useState<Vehicle>("ambulance");
  const [startNode, setStartNode] = useState(0);
  const [endNode, setEndNode] = useState(30);
  const [layers, setLayers] = useState<Layers>({
    elevation: true,
    flood: true,
    roads: true,
    drainage: true,
    manholes: true,
    rainfall: false,
    hotspots: true,
    route: true,
  });
  const [result, setResult] = useState<NowcastResult | null>(null);
  const [stage, setStage] = useState(-1);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState(false);
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lng: number } | null>(null);
  const modelRef = useRef<Model | null>(null);

  const city = CITIES[cityId];
  const terrain = useMemo(() => buildTerrain(city), [city]);
  const peakRain = scenario === "custom" ? customRain : SCENARIOS[scenario].peak;
  const nowcast = useMemo(() => rainfallNowcast(peakRain), [peakRain]);

  useEffect(() => {
    setResult(null);
    setSelection(null);
  }, [cityId]);

  useEffect(() => {
    setEndNode(Math.min(terrain.roadNodes.length - 1, 30));
    setStartNode(0);
  }, [terrain]);

  const run = async () => {
    if (running) return;
    setRunning(true);
    setSummary(false);
    setResult(null);
    for (let i = 0; i < PIPELINE_STAGES.length; i++) {
      setStage(i);
      await new Promise((r) => setTimeout(r, i === 7 ? 60 : 190));
      if (i === 7) {
        if (!modelRef.current) modelRef.current = trainModel().model;
        const res = runNowcast(terrain, peakRain, modelRef.current, blockage);
        setResult(res);
      }
    }
    setStage(-1);
    setRunning(false);
    setSummary(true);
  };

  const step = result?.steps[timeIdx] ?? null;
  const routes = useMemo(() => {
    if (!step) return { fastest: null, safest: null };
    return computeRoutes(terrain, step.mlDepth, startNode, endNode, vehicle);
  }, [terrain, step, startNode, endNode, vehicle]);

  const depthSeries = useMemo(() => {
    if (!result) return [];
    const top = result.hotspots.slice(0, 3);
    return result.steps.map((s, i) => {
      const row: Record<string, number | string> = { t: i === 0 ? "Now" : `+${s.t}` };
      top.forEach((h) => (row[h.name] = Math.round(s.mlDepth[h.cell]! * 10) / 10));
      row["Network max"] = Math.round(Math.max(...s.mlDepth) * 10) / 10;
      return row;
    });
  }, [result]);

  const drainSeries = useMemo(() => {
    if (!result) return [];
    return result.steps.map((s, i) => ({
      t: i === 0 ? "Now" : `+${s.t}`,
      overloaded: s.drains.filter((d) => d.utilization > 1).length,
      near: s.drains.filter((d) => d.utilization > 0.8 && d.utilization <= 1).length,
      avg: Math.round(
        (s.drains.reduce((a, d) => a + d.utilization, 0) / s.drains.length) * 100,
      ),
    }));
  }, [result]);

  const criticalDrains = step ? step.drains.filter((d) => d.utilization > 1) : [];
  const floodedRoadsNow = step
    ? terrain.roads.filter((r) => roadDepth(r, step.mlDepth) >= 15)
    : [];
  const maxDepthNow = step ? Math.round(Math.max(...step.mlDepth) * 10) / 10 : 0;
  const metrics = modelRef.current?.metrics ?? result?.model.metrics;

  return (
    <main className="min-h-screen text-foreground">
      {/* header */}
      <header className="border-border bg-card/70 sticky top-0 z-30 border-b backdrop-blur">
        <div className="flex flex-wrap items-center gap-4 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <div className="bg-primary/15 text-primary border-primary/40 flex h-9 w-9 items-center justify-center rounded border font-mono text-xs">
              UF
            </div>
            <div>
              <h1 className="text-lg leading-none font-semibold">URBAN FLOOD NOWCASTING SYSTEM</h1>
              <p className="label-xs mt-1">Real-Time Urban Flood Intelligence · 0–3 h lead time</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="label-xs border-accent/50 text-accent rounded border px-2 py-1">
              Prototype / Simulated Data
            </span>
            <span className="label-xs hidden md:inline">
              {city.name} · {city.ward} · {city.areaKm2} km²
            </span>
            <button
              onClick={run}
              disabled={running}
              className="bg-primary text-primary-foreground display rounded px-4 py-2 text-sm font-semibold tracking-widest disabled:opacity-60"
            >
              {running ? "RUNNING…" : "RUN FLOOD NOWCAST"}
            </button>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 p-3 xl:grid-cols-[250px_1fr_290px]">
        {/* ------------------------------------------------ left sidebar */}
        <aside className="space-y-3">
          <div className="panel p-3">
            <SectionTitle>City / Study Area</SectionTitle>
            <div className="grid gap-1">
              {Object.values(CITIES).map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCityId(c.id)}
                  className={`rounded border px-2 py-1.5 text-left text-sm ${
                    c.id === cityId
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:bg-secondary"
                  }`}
                >
                  {c.name}
                  <div className="label-xs mt-0.5 normal-case">{c.ward}</div>
                </button>
              ))}
            </div>
            <div className="label-xs mt-2 leading-relaxed normal-case">
              Drainage: {city.drainAge}. Synthetic DEM & network — replaceable with municipal GIS.
            </div>
          </div>

          <div className="panel p-3">
            <SectionTitle>Rainfall Scenario</SectionTitle>
            <div className="grid grid-cols-2 gap-1">
              {(Object.keys(SCENARIOS) as (keyof typeof SCENARIOS)[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setScenario(k)}
                  className={`rounded border px-2 py-1 text-xs ${
                    scenario === k ? "border-primary bg-primary/10 text-primary" : "border-border"
                  }`}
                >
                  {SCENARIOS[k].label}
                  <div className="font-mono text-[10px] opacity-70">{SCENARIOS[k].peak} mm/h</div>
                </button>
              ))}
              <button
                onClick={() => setScenario("custom")}
                className={`col-span-2 rounded border px-2 py-1 text-xs ${
                  scenario === "custom" ? "border-primary bg-primary/10 text-primary" : "border-border"
                }`}
              >
                Custom intensity
              </button>
            </div>
            <label className="label-xs mt-3 block">Peak intensity — {peakRain} mm/hr</label>
            <input
              type="range"
              min={2}
              max={180}
              value={peakRain}
              onChange={(e) => {
                setScenario("custom");
                setCustomRain(Number(e.target.value));
              }}
              className="accent-primary w-full"
            />
            <label className="label-xs mt-3 block">
              Simulated drain blockage — +{Math.round(blockage * 100)}%
            </label>
            <input
              type="range"
              min={0}
              max={60}
              value={blockage * 100}
              onChange={(e) => setBlockage(Number(e.target.value) / 100)}
              className="accent-accent w-full"
            />
          </div>

          <div className="panel p-3">
            <SectionTitle>Map Layers</SectionTitle>
            <div className="grid gap-1">
              {(Object.keys(layers) as (keyof Layers)[]).map((k) => (
                <label key={k} className="flex cursor-pointer items-center gap-2 text-xs capitalize">
                  <input
                    type="checkbox"
                    checked={layers[k]}
                    onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })}
                    className="accent-primary"
                  />
                  {k}
                </label>
              ))}
            </div>
          </div>

          <div className="panel p-3">
            <SectionTitle>Risk Filter</SectionTitle>
            <div className="grid gap-1">
              {RISK_LEVELS.map((r, i) => (
                <button
                  key={r}
                  onClick={() => setMinRisk(i)}
                  className={`flex items-center gap-2 rounded border px-2 py-1 text-xs ${
                    minRisk === i ? "border-primary" : "border-transparent"
                  }`}
                >
                  <span className="h-3 w-3 rounded-sm" style={{ background: RISK_COLOR[r] }} />
                  {r}
                  <span className="label-xs ml-auto">
                    {i === 0 ? "0–5" : i === 1 ? "5–15" : i === 2 ? "15–30" : i === 3 ? "30–50" : ">50"} cm
                  </span>
                </button>
              ))}
            </div>
            <p className="label-xs mt-2 normal-case">
              Prototype thresholds — not official municipal safety standards.
            </p>
          </div>

          <div className="panel p-3">
            <SectionTitle>ML Model</SectionTitle>
            {metrics ? (
              <div className="grid grid-cols-3 gap-2 font-mono text-xs">
                <div>
                  <div className="label-xs">MAE</div>
                  {metrics.mae} cm
                </div>
                <div>
                  <div className="label-xs">RMSE</div>
                  {metrics.rmse} cm
                </div>
                <div>
                  <div className="label-xs">R²</div>
                  {metrics.r2}
                </div>
                <div className="col-span-3 label-xs normal-case">
                  Gradient-boosted trees (XGBoost-style), {metrics.trees} trees, {metrics.rows} synthetic
                  rows from {metrics.storms} storms, storm-wise train/test split. Prototype ML model trained
                  on simulated scenarios.
                </div>
              </div>
            ) : (
              <p className="label-xs normal-case">Model trains on the first nowcast run.</p>
            )}
          </div>
        </aside>

        {/* ------------------------------------------------------- centre */}
        <section className="space-y-3">
          <div className="panel relative h-[520px] p-2">
            <FloodMap
              terrain={terrain}
              step={step}
              layers={layers}
              hotspots={result?.hotspots ?? []}
              route={layers.route ? routes.safest : null}
              altRoute={layers.route ? routes.fastest : null}
              focus={focus}
              minRisk={minRisk}
              rainfall={step?.rainfall ?? peakRain}
              onSelect={setSelection}
            />
            {!result && !running && (
              <div className="bg-background/70 absolute inset-2 z-20 flex flex-col items-center justify-center gap-3 rounded text-center">
                <p className="display text-xl">NO ACTIVE NOWCAST</p>
                <p className="text-muted-foreground max-w-sm text-sm">
                  Select a city and rainfall scenario, then run the coupled rainfall–terrain–drainage–ML
                  pipeline to generate a 0–3 hour street-level flood map.
                </p>
                <button
                  onClick={run}
                  className="bg-primary text-primary-foreground display rounded px-4 py-2 text-sm tracking-widest"
                >
                  RUN FLOOD NOWCAST
                </button>
              </div>
            )}
            {running && (
              <div className="bg-background/85 absolute inset-2 z-20 flex flex-col justify-center gap-1 rounded p-8 font-mono text-xs">
                {PIPELINE_STAGES.map((s, i) => (
                  <div
                    key={s}
                    className={
                      i < stage
                        ? "text-primary"
                        : i === stage
                          ? "text-accent"
                          : "text-muted-foreground/50"
                    }
                  >
                    {i < stage ? "✓" : i === stage ? "▸" : "·"} {i + 1}. {s}
                  </div>
                ))}
                <div className="bg-secondary mt-4 h-1.5 w-full overflow-hidden rounded">
                  <div
                    className="bg-primary h-full transition-all"
                    style={{ width: `${((stage + 1) / PIPELINE_STAGES.length) * 100}%` }}
                  />
                </div>
              </div>
            )}
            {selection && (
              <div className="panel absolute top-10 left-4 z-20 w-64 p-3 text-xs">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="label-xs">{selection.kind === "road" ? "Road segment" : "Grid cell"}</div>
                    <div className="text-sm font-semibold">{selection.name}</div>
                  </div>
                  <button className="text-muted-foreground" onClick={() => setSelection(null)}>
                    ✕
                  </button>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 font-mono">
                  <dt className="text-muted-foreground">Predicted depth</dt>
                  <dd>{selection.depth} cm</dd>
                  <dt className="text-muted-foreground">Prediction time</dt>
                  <dd>{timeIdx === 0 ? "Now" : `+${HORIZONS[timeIdx]} min`}</dd>
                  <dt className="text-muted-foreground">Elevation</dt>
                  <dd>{selection.elev} m</dd>
                  <dt className="text-muted-foreground">Slope</dt>
                  <dd>{selection.slope}%</dd>
                  <dt className="text-muted-foreground">Imperviousness</dt>
                  <dd>{Math.round(selection.imperv * 100)}%</dd>
                  <dt className="text-muted-foreground">Flow accum.</dt>
                  <dd>{selection.flowAcc}</dd>
                  <dt className="text-muted-foreground">Nearest drain</dt>
                  <dd>
                    {selection.drainName} · {selection.drainDist} m
                  </dd>
                  <dt className="text-muted-foreground">Drain utilisation</dt>
                  <dd>{Math.round(selection.drainUtil * 100)}%</dd>
                  <dt className="text-muted-foreground">Rainfall</dt>
                  <dd>{step?.rainfall ?? peakRain} mm/hr</dd>
                </dl>
                <div
                  className="mt-2 rounded px-2 py-1 text-center font-semibold"
                  style={{ background: RISK_COLOR[riskOf(selection.depth)], color: "#0b0f14" }}
                >
                  RISK: {riskOf(selection.depth)}
                </div>
              </div>
            )}
          </div>

          {/* timeline */}
          <div className="panel p-3">
            <SectionTitle
              right={
                <span className="label-xs">
                  Rainfall now {nowcast[0]!.mm} mm/hr · selected {step?.rainfall ?? "—"} mm/hr
                </span>
              }
            >
              Nowcast Timeline
            </SectionTitle>
            <input
              type="range"
              min={0}
              max={HORIZONS.length - 1}
              value={timeIdx}
              onChange={(e) => setTimeIdx(Number(e.target.value))}
              className="accent-primary w-full"
            />
            <div className="mt-1 flex justify-between font-mono text-[11px]">
              {HORIZONS.map((h, i) => (
                <button
                  key={h}
                  onClick={() => setTimeIdx(i)}
                  className={i === timeIdx ? "text-primary font-bold" : "text-muted-foreground"}
                >
                  {i === 0 ? "NOW" : `+${h}`}
                </button>
              ))}
            </div>
          </div>

          {/* bottom charts */}
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="panel p-3">
              <SectionTitle>Rainfall Nowcast (mm/hr)</SectionTitle>
              <ResponsiveContainer width="100%" height={140}>
                <AreaChart data={nowcast.map((n, i) => ({ t: i === 0 ? "Now" : `+${n.t}`, mm: n.mm }))}>
                  <CartesianGrid stroke="var(--grid-line)" />
                  <XAxis dataKey="t" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} width={28} />
                  <Tooltip {...tip} />
                  <Area dataKey="mm" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.22} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="panel p-3">
              <SectionTitle>Flood Depth vs Time (cm)</SectionTitle>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={depthSeries}>
                  <CartesianGrid stroke="var(--grid-line)" />
                  <XAxis dataKey="t" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} width={28} />
                  <Tooltip {...tip} />
                  {(result?.hotspots.slice(0, 3) ?? []).map((h, i) => (
                    <Line
                      key={h.key}
                      dataKey={h.name}
                      stroke={`var(--chart-${i + 2})`}
                      dot={{ r: 2 }}
                      strokeWidth={2}
                    />
                  ))}
                  <Line dataKey="Network max" stroke="var(--chart-1)" strokeDasharray="4 3" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="panel p-3">
              <SectionTitle>Drainage Load (nodes / avg %)</SectionTitle>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={drainSeries}>
                  <CartesianGrid stroke="var(--grid-line)" />
                  <XAxis dataKey="t" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} width={28} />
                  <Tooltip {...tip} />
                  <Bar dataKey="near" stackId="a" fill="var(--chart-2)" />
                  <Bar dataKey="overloaded" stackId="a" fill="var(--chart-4)" />
                  <Line dataKey="avg" stroke="var(--chart-1)" dot={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* key areas bar chart */}
          <div className="panel p-3">
            <SectionTitle right={<span className="label-xs">Click a bar to zoom the map</span>}>
              Key Areas — Predicted Maximum Flood Depth
            </SectionTitle>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart
                layout="vertical"
                data={(result?.hotspots ?? []).map((h) => ({ ...h, label: `${h.name} (+${h.peakT}m)` }))}
                margin={{ left: 40 }}
              >
                <CartesianGrid stroke="var(--grid-line)" />
                <XAxis type="number" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={150}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                />
                <Tooltip {...tip} />
                <Bar
                  dataKey="depth"
                  onClick={(d: unknown) => {
                    const h = d as { lat: number; lng: number };
                    setFocus({ lat: h.lat, lng: h.lng });
                  }}
                  cursor="pointer"
                >
                  {(result?.hotspots ?? []).map((h) => (
                    <Cell key={h.key} fill={RISK_COLOR[riskOf(h.depth)]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* ------------------------------------------------ right panel */}
        <aside className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Current rainfall" value={nowcast[0]!.mm} unit="mm/hr" />
            <Stat label="Predicted rainfall" value={step?.rainfall ?? "—"} unit="mm/hr" />
            <Stat label="Flooded roads" value={floodedRoadsNow.length} unit="segments" tone="var(--danger)" />
            <Stat label="Max flood depth" value={maxDepthNow} unit="cm" tone="var(--severe)" />
            <Stat label="Critical drains" value={criticalDrains.length} unit=">100%" tone="var(--warn)" />
            <Stat
              label="Road segs at risk"
              value={step ? terrain.roads.filter((r) => roadDepth(r, step.mlDepth) >= 5).length : 0}
            />
          </div>

          <div className="panel p-3">
            <SectionTitle>Emergency Alerts</SectionTitle>
            <div className="space-y-2">
              {(result?.alerts ?? []).map((a) => (
                <button
                  key={a.id}
                  onClick={() => setFocus({ lat: a.lat, lng: a.lng })}
                  className="w-full rounded border p-2 text-left text-xs"
                  style={{ borderColor: RISK_COLOR[a.risk] }}
                >
                  <div className="flex justify-between font-semibold">
                    <span>⚠ {a.name}</span>
                    <span style={{ color: RISK_COLOR[a.risk] }}>{a.risk}</span>
                  </div>
                  <div className="text-muted-foreground mt-1 font-mono">
                    Expected {a.depth} cm · critical in {a.minutes} min · drainage{" "}
                    {Math.round(a.drainUtil * 100)}%
                  </div>
                  <div className="text-accent mt-1">Recommended: avoid this location.</div>
                </button>
              ))}
              {!result && <p className="label-xs normal-case">No alerts until a nowcast is run.</p>}
              {result && result.alerts.length === 0 && (
                <p className="label-xs normal-case">No location exceeds the 15 cm alert threshold.</p>
              )}
            </div>
          </div>

          <div className="panel p-3">
            <SectionTitle>Flood-Safe Routing</SectionTitle>
            <label className="label-xs">Start</label>
            <select
              value={startNode}
              onChange={(e) => setStartNode(Number(e.target.value))}
              className="border-border bg-input mb-2 w-full rounded border px-2 py-1 text-xs"
            >
              {terrain.roadNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
            <label className="label-xs">Destination</label>
            <select
              value={endNode}
              onChange={(e) => setEndNode(Number(e.target.value))}
              className="border-border bg-input mb-2 w-full rounded border px-2 py-1 text-xs"
            >
              {terrain.roadNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
            <label className="label-xs">Vehicle</label>
            <select
              value={vehicle}
              onChange={(e) => setVehicle(e.target.value as Vehicle)}
              className="border-border bg-input mb-2 w-full rounded border px-2 py-1 text-xs"
            >
              {(Object.keys(VEHICLES) as Vehicle[]).map((v) => (
                <option key={v} value={v}>
                  {VEHICLES[v].label} (avoid &gt;{VEHICLES[v].maxDepth} cm)
                </option>
              ))}
            </select>
            {routes.fastest && (
              <div className="mt-2 space-y-2 font-mono text-xs">
                <div className="border-border rounded border p-2">
                  <div className="label-xs">Normal (shortest) route</div>
                  {(routes.fastest.distanceM / 1000).toFixed(2)} km · max {routes.fastest.maxDepth} cm ·{" "}
                  <span style={{ color: RISK_COLOR[routes.fastest.exposure] }}>
                    exposure {routes.fastest.exposure}
                  </span>
                </div>
                <div className="border-primary/60 rounded border p-2">
                  <div className="label-xs text-primary">Recommended safe route</div>
                  {routes.safest ? (
                    <>
                      {(routes.safest.distanceM / 1000).toFixed(2)} km · max {routes.safest.maxDepth} cm ·{" "}
                      <span style={{ color: RISK_COLOR[routes.safest.exposure] }}>
                        exposure {routes.safest.exposure}
                      </span>
                    </>
                  ) : (
                    <span className="text-destructive">
                      No route below the {VEHICLES[vehicle].label.toLowerCase()} depth limit.
                    </span>
                  )}
                </div>
              </div>
            )}
            {!step && <p className="label-xs normal-case">Run a nowcast to compute routes.</p>}
          </div>

          <div className="panel p-3">
            <SectionTitle>Top Flood Hotspots</SectionTitle>
            <ol className="space-y-1 text-xs">
              {(result?.hotspots ?? []).map((h, i) => (
                <li key={h.key}>
                  <button
                    onClick={() => setFocus({ lat: h.lat, lng: h.lng })}
                    className="hover:bg-secondary flex w-full justify-between rounded px-1 py-0.5 text-left"
                  >
                    <span>
                      {i + 1}. {h.name}
                    </span>
                    <span className="font-mono" style={{ color: RISK_COLOR[riskOf(h.depth)] }}>
                      {h.depth} cm @ +{h.peakT}m
                    </span>
                  </button>
                </li>
              ))}
              {!result && <p className="label-xs normal-case">—</p>}
            </ol>
          </div>

          <div className="panel p-3">
            <SectionTitle>Critical Drainage Nodes</SectionTitle>
            <div className="max-h-52 space-y-1 overflow-auto font-mono text-[11px]">
              {criticalDrains.slice(0, 12).map((d) => {
                const node = terrain.drains[d.id]!;
                return (
                  <div key={d.id} className="flex justify-between">
                    <button onClick={() => setFocus({ lat: node.lat, lng: node.lng })}>{node.name}</button>
                    <span className="text-muted-foreground">
                      Q {d.inflow.toFixed(2)}/{d.capacity.toFixed(2)} m³/s
                    </span>
                    <span style={{ color: d.utilization > 1.2 ? "var(--severe)" : "var(--danger)" }}>
                      {Math.round(d.utilization * 100)}%
                    </span>
                  </div>
                );
              })}
              {!criticalDrains.length && (
                <p className="label-xs normal-case">All modelled drains below capacity.</p>
              )}
            </div>
            <p className="label-xs mt-2 normal-case">
              Capacity from Manning Q = (1/n)·A·R^⅔·S^½ on simulated pipe geometry.
            </p>
          </div>

          <div className="panel p-3">
            <SectionTitle>Data Provenance</SectionTitle>
            <ul className="space-y-1 text-xs">
              <li>
                <span className="text-accent">◆ Simulated</span> — DEM, drainage graph, pipes, land use,
                road network
              </li>
              <li>
                <span className="text-primary">◆ Model output</span> — runoff, 2D flow, surcharge, flood
                depth, routes
              </li>
              <li>
                <span className="text-muted-foreground">◇ Real feeds (not connected)</span> — Doppler radar,
                municipal drainage GIS, IoT level sensors, OSM roads
              </li>
            </ul>
          </div>
        </aside>
      </div>

      {/* summary modal */}
      {summary && result && (
        <div className="bg-background/70 fixed inset-0 z-40 flex items-center justify-center p-4">
          <div className="panel w-full max-w-lg p-5">
            <h2 className="display text-xl">FLOOD NOWCAST SUMMARY</h2>
            <p className="label-xs mt-1">
              {city.name} · {city.ward} · prototype / simulated data
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-sm">
              <dt className="text-muted-foreground">Rainfall (peak)</dt>
              <dd>{peakRain} mm/hr</dd>
              <dt className="text-muted-foreground">Prediction window</dt>
              <dd>3 hours</dd>
              <dt className="text-muted-foreground">Flooded road segments</dt>
              <dd>{result.floodedRoads}</dd>
              <dt className="text-muted-foreground">Critical drainage nodes</dt>
              <dd>{result.criticalDrains}</dd>
              <dt className="text-muted-foreground">Max predicted depth</dt>
              <dd>{result.peakDepth} cm</dd>
              <dt className="text-muted-foreground">Highest-risk location</dt>
              <dd>{result.hotspots[0]?.name ?? "—"}</dd>
              <dt className="text-muted-foreground">Time to critical flooding</dt>
              <dd>{result.timeToCritical !== null ? `${result.timeToCritical} min` : "—"}</dd>
              <dt className="text-muted-foreground">Recommended action</dt>
              <dd>Avoid {result.alerts.length} locations</dd>
            </dl>
            <button
              onClick={() => setSummary(false)}
              className="bg-primary text-primary-foreground display mt-5 w-full rounded py-2 tracking-widest"
            >
              OPEN FLOOD MAP
            </button>
          </div>
        </div>
      )}

      <footer className="text-muted-foreground border-border border-t px-4 py-3 text-center text-xs">
        A coupled rainfall–terrain–drainage–ML system for street-level urban flood nowcasting. Physics engine
        handles water movement and drainage hydraulics; the gradient-boosted model provides fast flood-depth
        prediction. All datasets shown are synthetic prototypes, not municipal measurements.
      </footer>
    </main>
  );
}
