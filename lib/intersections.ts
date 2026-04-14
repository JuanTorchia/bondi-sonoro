/**
 * Intersecciones entre cuerdas.
 *
 * Este módulo se corre una sola vez al montar el mapa (memoized). Dadas
 * las polylines ya proyectadas a coordenadas de pantalla, encuentra todos
 * los puntos donde dos líneas se cruzan y los indexa por línea.
 *
 * Resultado por línea: lista ordenada de
 *   { progress: 0..1, other: "152", otherProgress: 0..1, point: [x,y] }
 *
 * Uso en runtime:
 *   Cada frame, para cada bondi, comparamos `previousProgress` vs `progress`.
 *   Si alguna intersección de su línea cae dentro de ese rango, el bondi
 *   acaba de "cruzar" esa cuerda ajena y disparamos un pluck en ella.
 *
 * Es el mecanismo original de Conductor (MTA.me): una línea no suena por
 * sí misma, suena cuando otra la cruza. El resultado colectivo es una
 * polifonía que sigue la geometría de la red.
 */

export interface Intersection {
  /** progreso (0..1) sobre la línea "A" donde ocurre el cruce */
  progress: number;
  /** identificador de la línea "B" que cruza */
  other: string;
  /** progreso (0..1) sobre la línea "B" */
  otherProgress: number;
  /** posición XY en screen space */
  point: [number, number];
}

export interface IntersectionIndex {
  byLine: Map<string, Intersection[]>;
}

/**
 * Intersección de dos segmentos 2D. Devuelve el punto y los parámetros t,u
 * o null si no se cruzan dentro de los segmentos.
 */
function segmentIntersect(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number]
): { point: [number, number]; t: number; u: number } | null {
  const [ax, ay] = a;
  const [bx, by] = b;
  const [cx, cy] = c;
  const [dx, dy] = d;

  const denom = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(denom) < 1e-9) return null; // paralelos

  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denom;
  const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / denom;

  if (t < 0 || t > 1 || u < 0 || u > 1) return null;

  return {
    point: [ax + t * (bx - ax), ay + t * (by - ay)],
    t,
    u,
  };
}

/**
 * Dada una polyline, devuelve longitudes acumuladas y total.
 * Reusado para convertir "estoy en el segmento i con t=0.3" en progreso global.
 */
function cumulativeLengths(poly: ReadonlyArray<readonly [number, number]>): {
  cum: number[];
  total: number;
} {
  const cum: number[] = [0];
  let total = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const len = Math.hypot(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1]);
    total += len;
    cum.push(total);
  }
  return { cum, total };
}

export function buildIntersectionIndex(
  lines: Array<{ id: string; polyline: Array<[number, number]> }>
): IntersectionIndex {
  const byLine = new Map<string, Intersection[]>();
  for (const l of lines) byLine.set(l.id, []);

  const meta = new Map<string, { cum: number[]; total: number }>();
  for (const l of lines) meta.set(l.id, cumulativeLengths(l.polyline));

  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const A = lines[i];
      const B = lines[j];
      const metaA = meta.get(A.id)!;
      const metaB = meta.get(B.id)!;

      // O(nA * nB) — aceptable porque cada línea tiene ≤200 puntos y son 20 líneas.
      // 20 * 20 / 2 = 190 pares × ~40.000 combinaciones = ~7.6M operaciones, ~50ms.
      for (let a = 0; a < A.polyline.length - 1; a++) {
        const sa = A.polyline[a];
        const sb = A.polyline[a + 1];
        for (let b = 0; b < B.polyline.length - 1; b++) {
          const ta = B.polyline[b];
          const tb = B.polyline[b + 1];
          const hit = segmentIntersect(sa, sb, ta, tb);
          if (!hit) continue;

          const segLenA = Math.hypot(sb[0] - sa[0], sb[1] - sa[1]);
          const segLenB = Math.hypot(tb[0] - ta[0], tb[1] - ta[1]);
          const absA = metaA.cum[a] + hit.t * segLenA;
          const absB = metaB.cum[b] + hit.u * segLenB;
          const progressA = metaA.total === 0 ? 0 : absA / metaA.total;
          const progressB = metaB.total === 0 ? 0 : absB / metaB.total;

          byLine.get(A.id)!.push({
            progress: progressA,
            other: B.id,
            otherProgress: progressB,
            point: hit.point,
          });
          byLine.get(B.id)!.push({
            progress: progressB,
            other: A.id,
            otherProgress: progressA,
            point: hit.point,
          });
        }
      }
    }
  }

  // Ordenamos por progreso — detectar cruces se vuelve un range scan
  for (const arr of byLine.values()) arr.sort((x, y) => x.progress - y.progress);
  return { byLine };
}

/**
 * Dado un bondi avanzando desde progressA → progressB (en la línea ownerLine),
 * devuelve todas las intersecciones cruzadas. Asume progressA <= progressB.
 */
export function intersectionsCrossed(
  index: IntersectionIndex,
  ownerLine: string,
  progressFrom: number,
  progressTo: number
): Intersection[] {
  if (progressFrom >= progressTo) return [];
  const list = index.byLine.get(ownerLine);
  if (!list || list.length === 0) return [];
  const out: Intersection[] = [];
  for (const i of list) {
    if (i.progress < progressFrom) continue;
    if (i.progress > progressTo) break;
    out.push(i);
  }
  return out;
}
