/**
 * Proxy server-side al endpoint de posiciones del GCBA.
 *
 * Por qué existe:
 * 1. Las credenciales (`client_id`, `client_secret`) no pueden viajar al
 *    browser. Viven en env vars y solo este handler las conoce.
 * 2. El feed completo pesa ~1.1MB con 3000+ vehículos. Filtramos a las
 *    líneas curadas antes de mandar al cliente → ~20-50KB.
 * 3. Cacheamos la respuesta por 30s. El GCBA actualiza cada ~1 min y con 30s
 *    de cache nos protegemos de thundering herd si muchos usuarios abren la
 *    demo al mismo tiempo.
 */

import { NextResponse } from "next/server";
import { CURATED_LINES } from "@/lib/curated-lines";

export const revalidate = 30;

interface UpstreamVehicle {
  route_id: string;
  latitude: number;
  longitude: number;
  speed: number;
  timestamp: number;
  id: string;
  direction: number;
  agency_name: string;
  agency_id: number;
  route_short_name: string;
  tip_id: string;
  trip_headsign: string;
}

export interface PositionPayload {
  generatedAt: number;
  vehicles: Array<{
    id: string;
    lineShort: string;      // "152" (sin sufijo)
    variant: string;        // "152A", "152B", etc.
    lat: number;
    lon: number;
    speed: number;          // m/s (del feed)
    direction: number;
    headsign: string;
    timestamp: number;
  }>;
}

const PREFIX_MATCHER = /^(\d+)[A-Z]?$/;
const CURATED_PREFIXES = new Set(CURATED_LINES.map((l) => l.routeShortName));

export async function GET() {
  const clientId = process.env.BA_TRANSPORT_CLIENT_ID;
  const clientSecret = process.env.BA_TRANSPORT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "BA_TRANSPORT_CLIENT_ID / BA_TRANSPORT_CLIENT_SECRET no configurados" },
      { status: 500 }
    );
  }

  const url = `https://apitransporte.buenosaires.gob.ar/colectivos/vehiclePositionsSimple?client_id=${clientId}&client_secret=${clientSecret}`;

  let upstream: UpstreamVehicle[];
  try {
    const res = await fetch(url, {
      next: { revalidate: 30 },
      headers: { "User-Agent": "bondi-sonoro/0.1 (+https://bondi-sonoro.vercel.app)" },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `upstream ${res.status}` },
        { status: 502 }
      );
    }
    upstream = await res.json();
  } catch (err) {
    return NextResponse.json(
      { error: `fetch failed: ${(err as Error).message}` },
      { status: 504 }
    );
  }

  const filtered: PositionPayload["vehicles"] = [];
  for (const v of upstream) {
    if (!v.route_short_name) continue;
    const match = v.route_short_name.match(PREFIX_MATCHER);
    if (!match) continue;
    const prefix = match[1];
    if (!CURATED_PREFIXES.has(prefix)) continue;

    filtered.push({
      id: v.id,
      lineShort: prefix,
      variant: v.route_short_name,
      lat: v.latitude,
      lon: v.longitude,
      speed: v.speed,
      direction: v.direction,
      headsign: v.trip_headsign,
      timestamp: v.timestamp,
    });
  }

  const payload: PositionPayload = {
    generatedAt: Date.now(),
    vehicles: filtered,
  };

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}
