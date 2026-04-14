"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { PositionPayload } from "@/app/api/positions/route";
import { makeProjector, nearestOnPolyline, polylineMeters } from "@/lib/projection";
import { ConductorEngine } from "@/lib/sonify";
import { buildIntersectionIndex, intersectionsCrossed, type IntersectionIndex } from "@/lib/intersections";

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
  screen: Array<[number, number]>;       // polyline en pantalla
  screenLength: number;                  // longitud total en px
  meters: number;                        // longitud real en metros
}

interface VehicleState {
  id: string;
  lineShort: string;
  /** progreso actual interpolado/simulado 0..1 */
  progress: number;
  /** último progreso conocido del feed — usado para corregir drift */
  serverProgress: number;
  /** speed reportada (m/s) */
  speed: number;
  /** timestamp del último update del server */
  lastUpdate: number;
  headsign: string;
  /** dirección en el feed: 0 ida / 1 vuelta. Usamos para sign de avance. */
  direction: number;
  /** progreso del último auto-pluck (para rítmica sobre la propia cuerda) */
  lastSelfPluckProgress: number;
}

interface PluckEvent {
  id: string;
  lineShort: string;
  x: number;
  y: number;
  color: string;
  /** si es rebote en intersección, suena más sutil */
  sympathetic?: boolean;
}

const VIEW_W = 1200;
const VIEW_H = 900;
const VIEW_PADDING = 40;

const POLL_MS = 30_000;
const TICK_MS = 1000 / 30;

/** Por defecto asumimos que un bondi "avanza" si no tenemos speed confiable. */
const DEFAULT_SPEED_MS = 4; // ~14 km/h
const MAX_SNAP_DISTANCE_PX = 180;
const SERVER_CORRECTION_RATE = 0.02; // cuánto del drift se corrige por frame

/**
 * Auto-pluck: cada cuánto (% de recorrido propio) el bondi puntea SU propia
 * cuerda. Piensa en un bajo tumbao: la cuerda propia aporta pulso, las
 * intersecciones aportan melodía.
 *
 * 0.012 ≈ cada ~120 m para una ruta de 10 km. Con speed real (~6 m/s) sale
 * un pluck propio cada ~20 s por bondi. Con muchos bondis, se empasta en
 * un ritmo denso y constante.
 */
const SELF_PLUCK_INTERVAL = 0.012;

export function StringsMap({ routes, playing, muted, onPluck, onVehiclesUpdate, engineRef }: Props) {
  const vehiclesRef = useRef<Map<string, VehicleState>>(new Map());
  const [pluckEvents, setPluckEvents] = useState<PluckEvent[]>([]);
  const [vehiclesSnapshot, setVehiclesSnapshot] = useState<VehicleState[]>([]);
  const [wobbleAmount, setWobbleAmount] = useState<Map<string, number>>(new Map());
  const lastFrameTimeRef = useRef<number>(0);

  // Proyección + métricas + intersecciones (memo: se recalculan solo si cambian las routes)
  const { projected, linesByShort, pathsByLine, intersectionIndex, project } = useMemo(() => {
    const projector = makeProjector(routes.globalBbox, {
      width: VIEW_W,
      height: VIEW_H,
      padding: VIEW_PADDING,
    });

    const projected: ProjectedLine[] = routes.lines.map((line) => {
      const screen: Array<[number, number]> = line.shape.map(([lat, lon]) => projector(lat, lon));
      let screenLength = 0;
      for (let i = 0; i < screen.length - 1; i++) {
        screenLength += Math.hypot(screen[i + 1][0] - screen[i][0], screen[i + 1][1] - screen[i][1]);
      }
      return {
        line,
        screen,
        screenLength,
        meters: polylineMeters(line.shape),
      };
    });

    const linesByShort = new Map<string, ProjectedLine>();
    for (const p of projected) linesByShort.set(p.line.routeShortName, p);

    const pathsByLine = new Map<string, string>();
    for (const p of projected) {
      const d = p.screen
        .map((pt, i) => `${i === 0 ? "M" : "L"}${pt[0].toFixed(2)} ${pt[1].toFixed(2)}`)
        .join(" ");
      pathsByLine.set(p.line.routeShortName, d);
    }

    const intersectionIndex: IntersectionIndex = buildIntersectionIndex(
      projected.map((p) => ({ id: p.line.routeShortName, polyline: p.screen }))
    );

    if (typeof window !== "undefined") {
      let totalCrossings = 0;
      for (const arr of intersectionIndex.byLine.values()) totalCrossings += arr.length;
      console.log(`[strings-map] ${projected.length} líneas, ${totalCrossings / 2} intersecciones únicas`);
    }

    return { projected, linesByShort, pathsByLine, intersectionIndex, project: projector };
  }, [routes]);

  // Poll al proxy — solo actualiza el "target" del server, no teletransporta
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

        const [px, py] = project(v.lat, v.lon);
        const snap = nearestOnPolyline(px, py, pLine.screen);
        if (snap.distance > MAX_SNAP_DISTANCE_PX) continue;
        activeCount++;
        seen.add(v.id);

        const existing = vehiclesRef.current.get(v.id);
        if (existing) {
          // El server report es la verdad. Lo guardamos aparte y corregimos
          // el progress simulado suavemente hacia él (anti-teletransporte).
          existing.serverProgress = snap.progress;
          existing.speed = v.speed;
          existing.lastUpdate = now;
          existing.headsign = v.headsign;
          existing.direction = v.direction;
        } else {
          vehiclesRef.current.set(v.id, {
            id: v.id,
            lineShort: v.lineShort,
            progress: snap.progress,
            serverProgress: snap.progress,
            speed: v.speed,
            lastUpdate: now,
            headsign: v.headsign,
            direction: v.direction,
            lastSelfPluckProgress: snap.progress,
          });
        }
      }

      // Limpieza de vehículos que no aparecieron en >2 minutos
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
  }, [playing, linesByShort, project, onVehiclesUpdate]);

  // Loop principal: simulación de avance + detección de intersecciones cruzadas
  useEffect(() => {
    if (!playing) return;

    const recentLinePlucks = new Map<string, number>(); // anti-spam por línea
    const globalPluckTimestamps: number[] = [];         // rate limit global

    lastFrameTimeRef.current = performance.now();

    /**
     * Registra un pluck respetando anti-spam por-línea Y rate limit global.
     * El rate limit evita que cuando llegue un poll y varios bondis crucen
     * intersecciones simultáneamente suenen 20 notas juntas como un acorde
     * extraño. Lo suavizamos a un máximo de 12 plucks/segundo.
     */
    function canPluck(lineShort: string, now: number, minGap = 180): boolean {
      while (globalPluckTimestamps.length > 0 && globalPluckTimestamps[0] < now - 1000) {
        globalPluckTimestamps.shift();
      }
      if (globalPluckTimestamps.length >= 12) return false;

      const lastOnLine = recentLinePlucks.get(lineShort) ?? 0;
      if (now - lastOnLine < minGap) return false;

      recentLinePlucks.set(lineShort, now);
      globalPluckTimestamps.push(now);
      return true;
    }

    function tick() {
      const now = performance.now();
      const dt = Math.min(0.2, (now - lastFrameTimeRef.current) / 1000);
      lastFrameTimeRef.current = now;

      const plucksToFire: PluckEvent[] = [];
      const wobbles = new Map<string, number>();

      for (const state of vehiclesRef.current.values()) {
        const pLine = linesByShort.get(state.lineShort);
        if (!pLine) continue;

        // ────── FASE 1: avance "real" por simulación ──────
        // Este es el ÚNICO movimiento que dispara plucks. Frame a frame,
        // continuo, basado en speed real.
        const effectiveSpeed = Math.max(state.speed, DEFAULT_SPEED_MS);
        const progressDelta = (effectiveSpeed * dt) / pLine.meters;
        const sign = state.direction === 1 ? -1 : 1;
        const simulatedProgress = state.progress + sign * progressDelta;

        const simFrom = Math.min(state.progress, simulatedProgress);
        const simTo = Math.max(state.progress, simulatedProgress);

        // Intersecciones cruzadas → pluck en la OTRA cuerda
        const crossed = intersectionsCrossed(intersectionIndex, state.lineShort, simFrom, simTo);
        for (const hit of crossed) {
          if (!canPluck(hit.other, now)) continue;
          const otherLine = linesByShort.get(hit.other);
          if (!otherLine) continue;

          plucksToFire.push({
            id: `x-${state.id}-${hit.other}-${now.toFixed(0)}`,
            lineShort: hit.other,
            x: hit.point[0],
            y: hit.point[1],
            color: otherLine.line.color,
          });
          const intensity = Math.max(0.5, Math.min(1, state.speed / 10));
          engineRef.current?.pluck(hit.other, otherLine.line.note, intensity);
          onPluck?.(hit.other);
          wobbles.set(hit.other, Math.max(wobbles.get(hit.other) ?? 0, intensity));
        }

        // Auto-pluck sobre la propia cuerda cada SELF_PLUCK_INTERVAL de avance.
        // Esto da RITMO (la intersección da melodía).
        const advancedSinceSelf = Math.abs(simulatedProgress - state.lastSelfPluckProgress);
        if (advancedSinceSelf > SELF_PLUCK_INTERVAL) {
          if (canPluck(state.lineShort, now, 260)) {
            const [sx, sy] = positionAtProgress(pLine.screen, simulatedProgress);
            plucksToFire.push({
              id: `s-${state.id}-${now.toFixed(0)}`,
              lineShort: state.lineShort,
              x: sx,
              y: sy,
              color: pLine.line.color,
              sympathetic: true,
            });
            const intensity = Math.max(0.25, Math.min(0.55, state.speed / 14));
            engineRef.current?.pluck(state.lineShort, pLine.line.note, intensity);
            wobbles.set(
              state.lineShort,
              Math.max(wobbles.get(state.lineShort) ?? 0, intensity * 0.5)
            );
          }
          state.lastSelfPluckProgress = simulatedProgress;
        }

        // ────── FASE 2: corrección hacia serverProgress ──────
        // Este salto NO dispara plucks — solo re-centra suavemente la posición
        // para que no deriva de la realidad. Aislar esta fase resuelve el
        // problema de "todo suena de golpe" cuando llega el poll cada 30s.
        const drift = state.serverProgress - simulatedProgress;
        const corrected = simulatedProgress + drift * SERVER_CORRECTION_RATE;
        state.progress = Math.max(0, Math.min(1, corrected));
      }

      if (plucksToFire.length > 0) {
        setPluckEvents((prev) => [...prev.slice(-25), ...plucksToFire]);
      }
      if (wobbles.size > 0) {
        setWobbleAmount(wobbles);
      }

      // Snapshot a ~15fps, suficiente para re-render de dots
      if (Math.floor(now / 66) !== Math.floor((now - TICK_MS) / 66)) {
        setVehiclesSnapshot(Array.from(vehiclesRef.current.values()));
      }
    }

    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [playing, linesByShort, engineRef, onPluck, intersectionIndex]);

  // Limpieza periódica de pluck events
  useEffect(() => {
    if (pluckEvents.length === 0) return;
    const t = setTimeout(() => setPluckEvents((prev) => prev.slice(-10)), 1200);
    return () => clearTimeout(t);
  }, [pluckEvents]);

  // Decay del wobble
  useEffect(() => {
    if (wobbleAmount.size === 0) return;
    const t = setTimeout(() => setWobbleAmount(new Map()), 350);
    return () => clearTimeout(t);
  }, [wobbleAmount]);

  return (
    <div className="relative w-full aspect-[4/3] max-h-[75vh] overflow-hidden vignette">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full scanlines"
      >
        {/* Cuerdas */}
        {projected.map((p) => {
          const isMuted = muted[p.line.routeShortName];
          const wobble = wobbleAmount.get(p.line.routeShortName) ?? 0;
          const d = pathsByLine.get(p.line.routeShortName);
          if (!d) return null;
          return (
            <motion.path
              key={p.line.routeShortName}
              d={d}
              fill="none"
              stroke={p.line.color}
              strokeWidth={1.2 + wobble * 1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={isMuted ? 0.14 : 0.45 + wobble * 0.55}
              style={{
                color: p.line.color,
                filter:
                  wobble > 0.25
                    ? "drop-shadow(0 0 8px currentColor) drop-shadow(0 0 22px currentColor)"
                    : "drop-shadow(0 0 3px currentColor)",
              }}
              animate={{ strokeWidth: 1.2 + wobble * 1.8 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            />
          );
        })}

        {/* Puntos de intersección — discretos pero visibles para entender el juego */}
        {Array.from(intersectionIndex.byLine.entries()).flatMap(([lineId, arr]) =>
          arr.map((x, i) => (
            <circle
              key={`int-${lineId}-${i}`}
              cx={x.point[0]}
              cy={x.point[1]}
              r={1.6}
              fill="#ffffff"
              opacity={0.12}
            />
          ))
        )}

        {/* Bondis */}
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

        {/* Pluck rings */}
        <AnimatePresence>
          {pluckEvents.map((p) => (
            <motion.circle
              key={p.id}
              cx={p.x}
              cy={p.y}
              stroke={p.color}
              fill="none"
              strokeWidth={2.2}
              initial={{ r: 4, opacity: 0.95 }}
              animate={{ r: 55, opacity: 0, strokeWidth: 0.5 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.1, ease: "easeOut" }}
              style={{ color: p.color, filter: "drop-shadow(0 0 10px currentColor)" }}
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
