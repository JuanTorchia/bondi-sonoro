/**
 * Fallback sintético — solo para que la demo nunca esté vacía.
 * Genera 20 curvas sinusoidales sobre la región CABA/GBA como "rutas de mentira".
 */

import { CURATED_LINES } from "../lib/curated-lines";
import type { RoutesFile } from "./build-routes";

// CABA aprox
const CENTER_LAT = -34.61;
const CENTER_LON = -58.42;
const SPREAD = 0.15;

function buildFake(): RoutesFile["lines"] {
  return CURATED_LINES.map((line, idx) => {
    const angle = (idx / CURATED_LINES.length) * Math.PI * 2;
    const shape: Array<[number, number]> = [];
    for (let t = -1; t <= 1; t += 0.01) {
      // curva tipo S parametrizada
      const latBase = CENTER_LAT + Math.sin(angle) * SPREAD * t;
      const lonBase = CENTER_LON + Math.cos(angle) * SPREAD * t;
      const wobble = 0.02 * Math.sin(t * Math.PI * 3 + idx);
      shape.push([latBase + wobble, lonBase + wobble * 0.5]);
    }
    const lats = shape.map((p) => p[0]);
    const lons = shape.map((p) => p[1]);
    return {
      routeShortName: line.routeShortName,
      note: line.note,
      color: line.color,
      description: line.description,
      shape,
      bbox: {
        minLat: Math.min(...lats),
        maxLat: Math.max(...lats),
        minLon: Math.min(...lons),
        maxLon: Math.max(...lons),
      },
    };
  });
}

const lines = buildFake();
const globalBbox = {
  minLat: Math.min(...lines.map((l) => l.bbox.minLat)),
  maxLat: Math.max(...lines.map((l) => l.bbox.maxLat)),
  minLon: Math.min(...lines.map((l) => l.bbox.minLon)),
  maxLon: Math.max(...lines.map((l) => l.bbox.maxLon)),
};

export const FALLBACK_ROUTES: RoutesFile = {
  generatedAt: new Date().toISOString(),
  source: "fallback-synthetic",
  lines,
  globalBbox,
};
