/**
 * Líneas curadas del AMBA.
 *
 * De las ~140 líneas de colectivos (y ~591 variantes con sufijos A/B/C/D…),
 * seleccionamos 20 que:
 *   - Cubren corredores icónicos de CABA (Corrientes, Santa Fe, Rivadavia, etc).
 *   - Son reconocibles por cualquier porteño.
 *   - Tienen alta frecuencia → la música no muere entre actualizaciones.
 *   - Cruzan entre sí formando intersecciones interesantes.
 *
 * Cada línea recibe una nota en pentatónica mayor y un color. Mantenemos un
 * mapa timbre/octava → textura visual para que la UI sea reconocible.
 */

export interface CuratedLine {
  /** número como lo conocemos los porteños */
  routeShortName: string;
  /** nota en pentatónica mayor en C (C D E G A) en octava 3–5 */
  note: string;
  /** color de la cuerda */
  color: string;
  /** descriptor humano para tooltip */
  description: string;
}

export const CURATED_LINES: CuratedLine[] = [
  { routeShortName: "60",  note: "C3", color: "#ef4444", description: "Constitución ↔ Tigre" },
  { routeShortName: "152", note: "D3", color: "#f97316", description: "La Boca ↔ Olivos" },
  { routeShortName: "29",  note: "E3", color: "#f59e0b", description: "La Boca ↔ Olivos (x Corrientes)" },
  { routeShortName: "7",   note: "G3", color: "#eab308", description: "Constitución ↔ Villa Real" },
  { routeShortName: "39",  note: "A3", color: "#84cc16", description: "Chacarita ↔ Barracas" },
  { routeShortName: "132", note: "C4", color: "#22c55e", description: "Retiro ↔ Pompeya" },
  { routeShortName: "12",  note: "D4", color: "#10b981", description: "Retiro ↔ Pompeya (x 9 de Julio)" },
  { routeShortName: "59",  note: "E4", color: "#14b8a6", description: "Retiro ↔ V. Ballester" },
  { routeShortName: "61",  note: "G4", color: "#06b6d4", description: "Constitución ↔ Liniers" },
  { routeShortName: "68",  note: "A4", color: "#0ea5e9", description: "Caballito ↔ Versalles" },
  { routeShortName: "92",  note: "C5", color: "#3b82f6", description: "Retiro ↔ Boulogne" },
  { routeShortName: "101", note: "D5", color: "#6366f1", description: "Chacarita ↔ San Telmo" },
  { routeShortName: "108", note: "E5", color: "#8b5cf6", description: "Once ↔ Lugano" },
  { routeShortName: "140", note: "G5", color: "#a855f7", description: "Plaza Italia ↔ Pompeya" },
  { routeShortName: "24",  note: "A5", color: "#d946ef", description: "La Boca ↔ Villa Crespo" },
  { routeShortName: "67",  note: "C4", color: "#ec4899", description: "Retiro ↔ Liniers" },
  { routeShortName: "151", note: "E4", color: "#f43f5e", description: "Flores ↔ Olivos" },
  { routeShortName: "10",  note: "G4", color: "#fb7185", description: "Plaza Italia ↔ Lugano" },
  { routeShortName: "5",   note: "D4", color: "#fda4af", description: "Plaza Italia ↔ Ciudadela" },
  { routeShortName: "111", note: "A4", color: "#fbbf24", description: "Retiro ↔ V. del Parque" },
];

export function findCuratedLine(routeShortName: string | undefined): CuratedLine | null {
  if (!routeShortName) return null;
  // El feed trae variantes (152A, 152B). Matcheamos por prefijo numérico puro.
  const pureNumber = routeShortName.replace(/[A-Z]$/, "");
  return CURATED_LINES.find((l) => l.routeShortName === pureNumber) ?? null;
}
