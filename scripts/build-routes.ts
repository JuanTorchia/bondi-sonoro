/**
 * Build-time: descargar GTFS estático de colectivos de BA, extraer las `shapes`
 * (polylines geográficas) de las líneas curadas y escribir un JSON liviano.
 *
 * Fuente: https://data.buenosaires.gob.ar/dataset/colectivos-gtfs
 *
 * Salida: `data/routes.json`
 *   {
 *     generatedAt: string,
 *     lines: [
 *       {
 *         routeShortName: "152",
 *         note: "D3",
 *         color: "#f97316",
 *         shape: [[lat, lon], ...],   // simplificado a ~200 puntos
 *         bbox: { minLat, maxLat, minLon, maxLon }
 *       },
 *       ...
 *     ]
 *   }
 *
 * Si falla la descarga, conserva el JSON committeado (fallback).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { CURATED_LINES, type CuratedLine } from "../lib/curated-lines";
import { FALLBACK_ROUTES } from "./fallback-routes";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");
const OUT_PATH = join(DATA_DIR, "routes.json");

const GTFS_SOURCES = [
  "https://cdn.buenosaires.gob.ar/datosabiertos/datasets/transporte-y-obras-publicas/colectivos-gtfs/colectivos-gtfs.zip",
  "https://data.buenosaires.gob.ar/dataset/colectivos-gtfs/resource/juqdkmgo-571-resource/download",
];

interface LineOutput {
  routeShortName: string;
  note: string;
  color: string;
  description: string;
  shape: Array<[number, number]>;
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
}

export interface RoutesFile {
  generatedAt: string;
  source: string;
  lines: LineOutput[];
  globalBbox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
}

function parseCsv(content: string): Record<string, string>[] {
  const lines = content.trim().split(/\r?\n/);
  const headers = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, (values[i] ?? "").replace(/"/g, "").trim()]));
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Douglas–Peucker simple para bajar ~miles de puntos a ~200.
 * No necesitamos precisión submétrica para la visualización.
 */
function simplifyPath(points: Array<[number, number]>, targetCount: number): Array<[number, number]> {
  if (points.length <= targetCount) return points;
  const step = points.length / targetCount;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i += step) {
    out.push(points[Math.floor(i)]);
  }
  if (out[out.length - 1] !== points[points.length - 1]) {
    out.push(points[points.length - 1]);
  }
  return out;
}

async function tryDownload(): Promise<Buffer | null> {
  const TIMEOUT_MS = 180_000;
  for (const url of GTFS_SOURCES) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      console.log(`[routes] intentando ${url}`);
      const res = await fetch(url, {
        headers: { "User-Agent": "bondi-sonoro/0.1" },
        signal: controller.signal,
      });
      if (!res.ok) {
        console.warn(`[routes] ${url} respondió ${res.status}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      console.log(`[routes] bajado ${(buf.length / 1024).toFixed(0)}KB`);
      return buf;
    } catch (err) {
      console.warn(`[routes] fallo ${url}: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

function parseGtfs(zipBuffer: Buffer, source: string): RoutesFile {
  const zip = new AdmZip(zipBuffer);
  const read = (name: string) => {
    const entry = zip.getEntry(name);
    if (!entry) throw new Error(`GTFS sin ${name}`);
    return entry.getData().toString("utf-8");
  };

  const routes = parseCsv(read("routes.txt"));
  const trips = parseCsv(read("trips.txt"));
  const shapes = parseCsv(read("shapes.txt"));

  // El dataset usa "152A", "152B", "60C", etc. — variantes por ramal.
  // Matcheamos por prefijo numérico puro ("152") y agrupamos todos los ramales.
  const prefixToRouteIds = new Map<string, string[]>();
  const shortToRouteIds = new Map<string, string[]>();
  for (const r of routes) {
    const short = r.route_short_name?.trim();
    if (!short) continue;
    if (!shortToRouteIds.has(short)) shortToRouteIds.set(short, []);
    shortToRouteIds.get(short)!.push(r.route_id);

    const prefixMatch = short.match(/^(\d+)[A-Z]?$/);
    if (prefixMatch) {
      const prefix = prefixMatch[1];
      if (!prefixToRouteIds.has(prefix)) prefixToRouteIds.set(prefix, []);
      prefixToRouteIds.get(prefix)!.push(r.route_id);
    }
  }

  // route_id → shape_id (tomamos uno representativo, el primero)
  const routeIdToShapeId = new Map<string, string>();
  for (const t of trips) {
    if (t.shape_id && !routeIdToShapeId.has(t.route_id)) {
      routeIdToShapeId.set(t.route_id, t.shape_id);
    }
  }

  // shape_id → lista ordenada de puntos
  const shapeIdToPoints = new Map<string, Array<[number, number, number]>>();
  for (const s of shapes) {
    const sid = s.shape_id;
    const lat = parseFloat(s.shape_pt_lat);
    const lon = parseFloat(s.shape_pt_lon);
    const seq = parseInt(s.shape_pt_sequence, 10);
    if (!sid || isNaN(lat) || isNaN(lon) || isNaN(seq)) continue;
    if (!shapeIdToPoints.has(sid)) shapeIdToPoints.set(sid, []);
    shapeIdToPoints.get(sid)!.push([lat, lon, seq]);
  }

  const output: LineOutput[] = [];
  const globalBbox = { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity };

  for (const line of CURATED_LINES) {
    // Intento primero exacto (por si alguien curó "152A"), después por prefijo.
    const routeIds =
      shortToRouteIds.get(line.routeShortName) ?? prefixToRouteIds.get(line.routeShortName) ?? [];
    if (routeIds.length === 0) {
      console.warn(`[routes] no encontré route_id para línea ${line.routeShortName}`);
      continue;
    }
    // Buscamos el primer route_id que tenga shape asociada (algunos ramales no tienen).
    let shapeId: string | undefined;
    for (const rid of routeIds) {
      const sid = routeIdToShapeId.get(rid);
      if (sid) { shapeId = sid; break; }
    }
    if (!shapeId) {
      console.warn(`[routes] no encontré shape_id para ${line.routeShortName}`);
      continue;
    }
    const raw = shapeIdToPoints.get(shapeId);
    if (!raw || raw.length === 0) continue;

    raw.sort((a, b) => a[2] - b[2]);
    const pts: Array<[number, number]> = raw.map(([lat, lon]) => [lat, lon]);
    const simplified = simplifyPath(pts, 200);

    const bbox = { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity };
    for (const [lat, lon] of simplified) {
      bbox.minLat = Math.min(bbox.minLat, lat);
      bbox.maxLat = Math.max(bbox.maxLat, lat);
      bbox.minLon = Math.min(bbox.minLon, lon);
      bbox.maxLon = Math.max(bbox.maxLon, lon);
      globalBbox.minLat = Math.min(globalBbox.minLat, lat);
      globalBbox.maxLat = Math.max(globalBbox.maxLat, lat);
      globalBbox.minLon = Math.min(globalBbox.minLon, lon);
      globalBbox.maxLon = Math.max(globalBbox.maxLon, lon);
    }

    output.push({
      routeShortName: line.routeShortName,
      note: line.note,
      color: line.color,
      description: line.description,
      shape: simplified,
      bbox,
    });
    console.log(`[routes] ✓ ${line.routeShortName}: ${simplified.length} puntos`);
  }

  return {
    generatedAt: new Date().toISOString(),
    source,
    lines: output,
    globalBbox,
  };
}

async function main() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  const zipBuffer = await tryDownload();
  let result: RoutesFile;

  if (zipBuffer) {
    try {
      result = parseGtfs(zipBuffer, GTFS_SOURCES[0]);
      if (result.lines.length === 0) throw new Error("ninguna línea matcheada");
      console.log(`[routes] ✓ parseado: ${result.lines.length}/${CURATED_LINES.length} líneas`);
    } catch (err) {
      console.error(`[routes] error parseando: ${(err as Error).message}`);
      if (existsSync(OUT_PATH)) {
        console.log("[routes] conservo routes.json existente");
        return;
      }
      result = FALLBACK_ROUTES;
    }
  } else if (existsSync(OUT_PATH)) {
    console.log("[routes] sin red, conservo routes.json existente");
    return;
  } else {
    console.log("[routes] sin red + sin snapshot, usando fallback sintético");
    result = FALLBACK_ROUTES;
  }

  writeFileSync(OUT_PATH, JSON.stringify(result, null, 2));
  console.log(`[routes] escribí ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
