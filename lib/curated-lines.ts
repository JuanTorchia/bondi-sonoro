/**
 * Líneas curadas del AMBA.
 *
 * De las ~140 líneas (y ~591 variantes con sufijos A/B/C…), curamos ~40
 * que cubren los corredores icónicos de CABA y primer cordón. Criterios:
 *   - Reconocibilidad porteña.
 *   - Alta frecuencia → la música no muere entre actualizaciones.
 *   - Geometría que produce intersecciones ricas entre sí.
 *
 * Cada línea tiene una nota en pentatónica mayor en C (15 notas en el
 * span C3..A5) y un color. Varias líneas comparten nota en distinta
 * octava — refuerza la consonancia sin volver predecible la pieza.
 */

export interface CuratedLine {
  routeShortName: string;
  note: string;
  color: string;
  description: string;
}

export const CURATED_LINES: CuratedLine[] = [
  // Troncales históricos (bajos/graves)
  { routeShortName: "60",  note: "C3", color: "#ef4444", description: "Constitución ↔ Tigre" },
  { routeShortName: "152", note: "D3", color: "#f97316", description: "La Boca ↔ Olivos" },
  { routeShortName: "29",  note: "E3", color: "#f59e0b", description: "La Boca ↔ Olivos (x Corrientes)" },
  { routeShortName: "7",   note: "G3", color: "#eab308", description: "Constitución ↔ Villa Real" },
  { routeShortName: "39",  note: "A3", color: "#84cc16", description: "Chacarita ↔ Barracas" },

  // Troncales medios
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

  // Segundo anillo
  { routeShortName: "67",  note: "C4", color: "#ec4899", description: "Retiro ↔ Liniers" },
  { routeShortName: "151", note: "E4", color: "#f43f5e", description: "Flores ↔ Olivos" },
  { routeShortName: "10",  note: "G4", color: "#fb7185", description: "Plaza Italia ↔ Lugano" },
  { routeShortName: "5",   note: "D4", color: "#fda4af", description: "Plaza Italia ↔ Ciudadela" },
  { routeShortName: "111", note: "A4", color: "#fbbf24", description: "Retiro ↔ V. del Parque" },

  // Expansión: corredores longitudinales + diagonales
  { routeShortName: "15",  note: "E3", color: "#fde047", description: "La Boca ↔ 9 de Julio Sur" },
  { routeShortName: "17",  note: "G3", color: "#a3e635", description: "Constitución ↔ Villa Luro" },
  { routeShortName: "19",  note: "D3", color: "#4ade80", description: "Ministro Brin ↔ V. del Parque" },
  { routeShortName: "20",  note: "C4", color: "#2dd4bf", description: "Pompeya ↔ La Boca" },
  { routeShortName: "23",  note: "E4", color: "#22d3ee", description: "Flores ↔ Villa Crespo" },
  { routeShortName: "26",  note: "G4", color: "#38bdf8", description: "Retiro ↔ Liniers (x Rivadavia)" },
  { routeShortName: "34",  note: "A4", color: "#60a5fa", description: "Retiro ↔ Mataderos" },
  { routeShortName: "37",  note: "D4", color: "#818cf8", description: "Retiro ↔ Flores" },
  { routeShortName: "42",  note: "C5", color: "#a78bfa", description: "Chacarita ↔ Boca" },
  { routeShortName: "44",  note: "E5", color: "#c084fc", description: "Once ↔ Villa Crespo" },
  { routeShortName: "45",  note: "G5", color: "#e879f9", description: "Retiro ↔ Villa Crespo" },
  { routeShortName: "46",  note: "A5", color: "#f0abfc", description: "Diagonal Norte ↔ Parque Patricios" },
  { routeShortName: "50",  note: "C4", color: "#fb923c", description: "Lugano ↔ Centro" },
  { routeShortName: "53",  note: "D4", color: "#fbbf24", description: "La Boca ↔ Nuñez" },
  { routeShortName: "55",  note: "E4", color: "#facc15", description: "Retiro ↔ Flores" },
  { routeShortName: "56",  note: "G4", color: "#a3e635", description: "Once ↔ Pompeya" },
  { routeShortName: "64",  note: "A4", color: "#34d399", description: "Barracas ↔ Villa Devoto" },
  { routeShortName: "65",  note: "C5", color: "#14b8a6", description: "Constitución ↔ Villa del Parque" },
  { routeShortName: "105", note: "E5", color: "#22d3ee", description: "Plaza Italia ↔ Flores" },
  { routeShortName: "160", note: "G5", color: "#93c5fd", description: "Once ↔ V. Ballester" },
];
