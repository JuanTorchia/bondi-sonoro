/**
 * Proyección geo → pantalla.
 *
 * Buenos Aires está cerca de -34°S, muy lejos del ecuador — una proyección
 * Mercator distorsionaría visiblemente. Usamos una proyección local muy
 * simple (equirectangular con corrección coseno), suficiente para la escala
 * de una ciudad. Hace que las curvas se vean como en Google Maps dentro del
 * AMBA.
 *
 * El bbox global (min/max lat/lon de todas las rutas) se mapea al viewport.
 * Preservamos aspect ratio: añadimos padding en el eje que sobra para que
 * nada salga cortado.
 */

export interface Bbox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface Viewport {
  width: number;
  height: number;
  padding: number;
}

const EARTH_COS_BA = Math.cos((-34.6 * Math.PI) / 180);
const METERS_PER_DEG_LAT = 111_320;

/** Longitud aproximada en metros de una polyline lat/lon en la latitud de BA. */
export function polylineMeters(shape: ReadonlyArray<readonly [number, number]>): number {
  let total = 0;
  for (let i = 0; i < shape.length - 1; i++) {
    const [lat1, lon1] = shape[i];
    const [lat2, lon2] = shape[i + 1];
    const dLat = (lat2 - lat1) * METERS_PER_DEG_LAT;
    const dLon = (lon2 - lon1) * METERS_PER_DEG_LAT * EARTH_COS_BA;
    total += Math.hypot(dLat, dLon);
  }
  return total;
}

export function makeProjector(bbox: Bbox, viewport: Viewport) {
  const { minLat, maxLat, minLon, maxLon } = bbox;
  const { width, height, padding } = viewport;

  // Tamaño geográfico "real" (metros-ish, usando cos latitud)
  const geoWidth = (maxLon - minLon) * EARTH_COS_BA;
  const geoHeight = maxLat - minLat;

  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  // Escala que preserva aspect ratio (el eje más limitado define la escala)
  const scale = Math.min(innerW / geoWidth, innerH / geoHeight);

  const usedW = geoWidth * scale;
  const usedH = geoHeight * scale;
  const offsetX = padding + (innerW - usedW) / 2;
  const offsetY = padding + (innerH - usedH) / 2;

  return function project(lat: number, lon: number): [number, number] {
    const x = offsetX + (lon - minLon) * EARTH_COS_BA * scale;
    // SVG tiene Y invertido (arriba = 0), así que mapeamos maxLat arriba
    const y = offsetY + (maxLat - lat) * scale;
    return [x, y];
  };
}

/**
 * Dado un punto y una polyline (en coords de pantalla), devuelve el segmento
 * más cercano, la distancia al mismo y la proyección (clamp sobre el segmento).
 * Se usa para "snapear" la posición reportada del bondi a la línea que está
 * recorriendo — así el dot siempre viaja sobre la cuerda, no flotando al lado.
 */
export function nearestOnPolyline(
  px: number,
  py: number,
  polyline: ReadonlyArray<readonly [number, number]>
): {
  segmentIndex: number;
  projected: [number, number];
  distance: number;
  /** t ∈ [0,1] posición sobre el segmento */
  t: number;
  /** progreso acumulado 0..1 sobre toda la polyline */
  progress: number;
} {
  let best: {
    segmentIndex: number;
    projected: [number, number];
    distance: number;
    t: number;
    progress: number;
  } | null = null;

  const segLengths: number[] = [];
  let total = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const [ax, ay] = polyline[i];
    const [bx, by] = polyline[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    segLengths.push(len);
    total += len;
  }

  let acc = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const [ax, ay] = polyline[i];
    const [bx, by] = polyline[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    const projx = ax + t * dx;
    const projy = ay + t * dy;
    const dist = Math.hypot(px - projx, py - projy);

    const progress = total === 0 ? 0 : (acc + t * segLengths[i]) / total;

    if (!best || dist < best.distance) {
      best = { segmentIndex: i, projected: [projx, projy], distance: dist, t, progress };
    }

    acc += segLengths[i];
  }

  return best ?? { segmentIndex: 0, projected: [px, py], distance: 0, t: 0, progress: 0 };
}
