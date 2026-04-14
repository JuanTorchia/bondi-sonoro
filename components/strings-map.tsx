"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { PositionPayload } from "@/app/api/positions/route";
import type { CuratedLine } from "@/lib/curated-lines";
import { makeProjector, nearestOnPolyline } from "@/lib/projection";
import { ConductorEngine } from "@/lib/sonify";

interface Line {
  routeShortName: string;
  note: string;
  color: string;
  description: string;
  shape: Array<[number, number]>;
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
}

interface RoutesFile {
  generatedAt: string;
  source: string;
  lines: Line[];
  globalBbox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
}

interface Props {
  routes: RoutesFile;
  playing: boolean;
  muted: Record<string, boolean>;
  onPluck?: (lineShort: string) => void;
  onVehiclesUpdate?: (count: number) => void;
  engineRef: React.MutableRefObject<ConductorEngine | null>;
}

interface ProjectedLine {
  line: Line;
  /** polyline en coords pantalla */
  screen: Array<[number, number]>;
  /** total length en px — para posicionar bondis */
  totalLength: number;
}

interface VehicleState {
  id: string;
  lineShort: string;
  /** progreso actual interpolado 0..1 sobre la polyline */
  progress: number;
  /** progreso target tras el último update del server */
  targetProgress: number;
  /** timestamp del último update */
  lastUpdate: number;
  /** velocidad reportada (m/s) */
  speed: number;
  headsign: string;
}

interface PluckEvent {
  id: string;
  lineShort: string;
  x: number;
  y: number;
  color: string;
}

/**
 * VIEWPORT interno — SVG virtual de 1200x900. El CSS se encarga de escalar
 * a la pantalla real. Esto hace que los cálculos sean independientes del
 * tamaño real del container.
 */
const VIEW_W = 1200;
const VIEW_H = 900;
const VIEW_PADDING = 40;

const POLL_MS = 30_000;      // polling al /api/positions
const TICK_MS = 1000 / 30;   // 30fps para interpolación
const PROGRESS_THRESHOLD = 0.005; // cambio mínimo para disparar pluck (~0.5% del recorrido)

export function StringsMap({ routes, playing, muted, onPluck, onVehiclesUpdate, engineRef }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const vehiclesRef = useRef<Map<string, VehicleState>>(new Map());
  const [pluckEvents, setPluckEvents] = useState<PluckEvent[]>([]);
  const [vehiclesSnapshot, setVehiclesSnapshot] = useState<VehicleState[]>([]);
  const [wobbleAmount, setWobbleAmount] = useState<Map<string, number>>(new Map());

  // Proyección pre-computada (cambia solo si cambian las routes)
  const projected: ProjectedLine[] = useMemo(() => {
    const project = makeProjector(routes.globalBbox, {
      width: VIEW_W,
      height: VIEW_H,
      padding: VIEW_PADDING,
    });
    return routes.lines.map((line) => {
      const screen: Array<[number, number]> = line.shape.map(([lat, lon]) => project(lat, lon));
      let total = 0;
      for (let i = 0; i < screen.length - 1; i++) {
        total += Math.hypot(screen[i + 1][0] - screen[i][0], screen[i + 1][1] - screen[i][1]);
      }
      return { line, screen, totalLength: total };
    });
  }, [routes]);

  const linesByShort = useMemo(() => {
    const map = new Map<string, ProjectedLine>();
    for (const p of projected) map.set(p.line.routeShortName, p);
    return map;
  }, [projected]);

  // Path SVG string por línea (memoizado)
  const pathsByLine = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projected) {
      const d = p.screen
        .map((pt, i) => `${i === 0 ? "M" : "L"}${pt[0].toFixed(2)} ${pt[1].toFixed(2)}`)
        .join(" ");
      map.set(p.line.routeShortName, d);
    }
    return map;
  }, [projected]);

  // Poll al proxy
  useEffect(() => {
    if (!playing) return;

    let cancelled = false;
    async function fetchPositions() {
      try {
        const res = await fetch("/api/positions", { cache: "no-store" });
        if (!res.ok) return;
        const payload: PositionPayload = await res.json();
        if (cancelled) return;
        applyUpdate(payload);
      } catch {
        /* ignore */
      }
    }

    function applyUpdate(payload: PositionPayload) {
      const now = performance.now();
      const seen = new Set<string>();
      let activeCount = 0;

      for (const v of payload.vehicles) {
        const pLine = linesByShort.get(v.lineShort);
        if (!pLine) continue;

        // Proyectamos lat/lon del vehículo a pantalla y snapeamos a la línea
        const project = makeProjector(routes.globalBbox, {
          width: VIEW_W,
          height: VIEW_H,
          padding: VIEW_PADDING,
        });
        const [px, py] = project(v.lat, v.lon);
        const snap = nearestOnPolyline(px, py, pLine.screen);

        // Ignoramos vehículos que están a >80px de su ruta (datos ruidosos)
        if (snap.distance > 80) continue;
        activeCount++;
        seen.add(v.id);

        const prev = vehiclesRef.current.get(v.id);
        if (prev) {
          prev.targetProgress = snap.progress;
          prev.lastUpdate = now;
          prev.speed = v.speed;
          prev.headsign = v.headsign;
        } else {
          vehiclesRef.current.set(v.id, {
            id: v.id,
            lineShort: v.lineShort,
            progress: snap.progress,
            targetProgress: snap.progress,
            lastUpdate: now,
            speed: v.speed,
            headsign: v.headsign,
          });
        }
      }

      // Limpiamos vehículos que no aparecieron en este update hace >2 minutos
      for (const [id, state] of vehiclesRef.current) {
        if (!seen.has(id) && now - state.lastUpdate > 120_000) {
          vehiclesRef.current.delete(id);
        }
      }

      onVehiclesUpdate?.(activeCount);
    }

    fetchPositions();
    const interval = setInterval(fetchPositions, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [playing, linesByShort, routes.globalBbox, onVehiclesUpdate]);

  // Loop de animación + detección de cruces → pluck
  useEffect(() => {
    if (!playing) {
      if (rafRef.current !== null) {
        clearInterval(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const previousProgress = new Map<string, number>();
    const recentPlucks = new Map<string, number>(); // lineShort → timestamp

    function tick() {
      const now = performance.now();
      const plucksToFire: PluckEvent[] = [];
      const wobbles = new Map<string, number>();

      for (const state of vehiclesRef.current.values()) {
        // Interpolamos progreso lentamente hacia target (suavizado exponencial)
        const diff = state.targetProgress - state.progress;
        if (Math.abs(diff) > 0.00001) {
          state.progress += diff * 0.035; // constante de smooth
        }

        const prev = previousProgress.get(state.id) ?? state.progress;
        const delta = Math.abs(state.progress - prev);

        if (delta > PROGRESS_THRESHOLD) {
          // Anti-spam: máximo un pluck por línea cada 400ms
          const lastPluck = recentPlucks.get(state.lineShort) ?? 0;
          if (now - lastPluck > 400) {
            const pLine = linesByShort.get(state.lineShort);
            if (pLine) {
              const [px, py] = positionAtProgress(pLine.screen, state.progress);
              const color = pLine.line.color;
              plucksToFire.push({
                id: `${state.id}-${now.toFixed(0)}`,
                lineShort: state.lineShort,
                x: px,
                y: py,
                color,
              });
              recentPlucks.set(state.lineShort, now);

              const intensity = Math.min(1, state.speed / 15);
              engineRef.current?.pluck(state.lineShort, pLine.line.note, intensity);
              onPluck?.(state.lineShort);

              wobbles.set(state.lineShort, Math.max(wobbles.get(state.lineShort) ?? 0, intensity));
            }
          }
        }
        previousProgress.set(state.id, state.progress);
      }

      if (plucksToFire.length > 0) {
        setPluckEvents((prev) => [...prev.slice(-20), ...plucksToFire]);
      }
      if (wobbles.size > 0) {
        setWobbleAmount(new Map(wobbles));
      }

      // Snapshot de vehículos para render (no queremos rehacer a cada frame)
      if (Math.floor(now / 66) !== Math.floor((now - TICK_MS) / 66)) {
        setVehiclesSnapshot(Array.from(vehiclesRef.current.values()));
      }
    }

    const id = setInterval(tick, TICK_MS);
    rafRef.current = id as unknown as number;
    return () => clearInterval(id);
  }, [playing, linesByShort, engineRef, onPluck]);

  // Limpieza de pluck events tras su animación
  useEffect(() => {
    if (pluckEvents.length === 0) return;
    const t = setTimeout(() => setPluckEvents([]), 1000);
    return () => clearTimeout(t);
  }, [pluckEvents.length]);

  return (
    <div className="relative w-full aspect-[4/3] max-h-[75vh] overflow-hidden vignette">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full scanlines"
      >
        {/* Cuerdas (polylines) */}
        {projected.map((p) => {
          const muted_ = muted[p.line.routeShortName];
          const wobble = wobbleAmount.get(p.line.routeShortName) ?? 0;
          const d = pathsByLine.get(p.line.routeShortName);
          if (!d) return null;
          return (
            <motion.path
              key={p.line.routeShortName}
              d={d}
              fill="none"
              stroke={p.line.color}
              strokeWidth={1.2 + wobble * 1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={muted_ ? 0.18 : 0.5 + wobble * 0.5}
              style={{
                color: p.line.color,
                filter: wobble > 0.3 ? "drop-shadow(0 0 6px currentColor) drop-shadow(0 0 18px currentColor)" : `drop-shadow(0 0 3px currentColor)`,
              }}
              animate={{
                strokeWidth: 1.2 + wobble * 1.4,
              }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            />
          );
        })}

        {/* Bondis animados — dots con glow */}
        {vehiclesSnapshot.map((v) => {
          const pLine = linesByShort.get(v.lineShort);
          if (!pLine) return null;
          const [x, y] = positionAtProgress(pLine.screen, v.progress);
          return (
            <circle
              key={v.id}
              cx={x}
              cy={y}
              r={3.2}
              fill={pLine.line.color}
              style={{ color: pLine.line.color, filter: "drop-shadow(0 0 5px currentColor)" }}
              opacity={muted[v.lineShort] ? 0.25 : 0.95}
            />
          );
        })}

        {/* Pluck rings — anillos que expanden y se desvanecen */}
        <AnimatePresence>
          {pluckEvents.map((p) => (
            <motion.circle
              key={p.id}
              cx={p.x}
              cy={p.y}
              stroke={p.color}
              fill="none"
              strokeWidth={2}
              initial={{ r: 4, opacity: 0.9 }}
              animate={{ r: 50, opacity: 0, strokeWidth: 0.5 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.9, ease: "easeOut" }}
              style={{ color: p.color, filter: "drop-shadow(0 0 8px currentColor)" }}
            />
          ))}
        </AnimatePresence>
      </svg>
    </div>
  );
}

function positionAtProgress(
  screen: Array<[number, number]>,
  progress: number
): [number, number] {
  if (screen.length === 0) return [0, 0];
  if (screen.length === 1) return screen[0];

  // Longitudes acumuladas
  const lens: number[] = [];
  let total = 0;
  for (let i = 0; i < screen.length - 1; i++) {
    const len = Math.hypot(screen[i + 1][0] - screen[i][0], screen[i + 1][1] - screen[i][1]);
    lens.push(len);
    total += len;
  }
  const target = progress * total;

  let acc = 0;
  for (let i = 0; i < lens.length; i++) {
    if (acc + lens[i] >= target) {
      const t = lens[i] === 0 ? 0 : (target - acc) / lens[i];
      return [
        screen[i][0] + t * (screen[i + 1][0] - screen[i][0]),
        screen[i][1] + t * (screen[i + 1][1] - screen[i][1]),
      ];
    }
    acc += lens[i];
  }
  return screen[screen.length - 1];
}
