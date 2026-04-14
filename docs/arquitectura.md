# Arquitectura

## Diagrama

```
┌──────────────────────────┐
│ GTFS estático (GCBA)      │   200MB zip, se baja una vez
│  routes / trips / shapes  │   Regenera data/routes.json (~250KB)
└──────────┬────────────────┘
           │  pnpm gtfs:fetch (manual)
           ▼
┌──────────────────────────┐
│ data/routes.json          │   20 líneas curadas, committeado
│  polylines + notas        │
└──────────┬────────────────┘
           │  import estático (Server Component)
           ▼
┌──────────────────────────┐         ┌──────────────────────────────┐
│ app/page.tsx              │────────▶│ /api/positions                │
│ (Server Component)        │         │ (Route Handler, server-side)  │
└──────────┬────────────────┘         └────────────┬──────────────────┘
           │                                       │ cada 30s
           ▼                                       │ con credenciales
┌──────────────────────────┐                      ▼
│ PlayerShell (Client)      │         ┌──────────────────────────────┐
│  ├─ StringsMap            │──fetch──▶│ API GCBA (apitransporte...)  │
│  ├─ sidebar líneas        │  30s    │ vehiclePositionsSimple        │
│  └─ transport-engine      │         └──────────────────────────────┘
└──────────┬────────────────┘
           │  en cada update:
           │   1. proyecta lat/lon a SVG
           │   2. snapea cada bondi a su polyline
           │   3. interpola progreso 30fps hacia target
           │   4. detecta avance → Tone.js pluck + wobble
           ▼
     Speaker + pantalla
```

## Decisiones arquitectónicas (ADRs)

### ADR-01 · Credenciales server-side

**Decisión.** `BA_TRANSPORT_CLIENT_ID` y `BA_TRANSPORT_CLIENT_SECRET` viven solo en variables de entorno. El browser nunca las ve. Un Route Handler de Next.js (`/api/positions`) actúa como proxy.

**Por qué.** Aunque la API no es crítica, repetir credenciales públicas sin capa intermedia las expone a abuso. Un proxy también nos permite filtrar el payload: el feed del GCBA pesa ~1.1MB con 3000 vehículos; mandamos solo ~20KB con los de nuestras líneas curadas.

### ADR-02 · GTFS estático committeado, no en build-time

**Decisión.** El GTFS pesa ~200MB. Bajarlo en cada build de Vercel es lento, frágil y caro. Corremos `pnpm gtfs:fetch` manualmente en local, committeamos `data/routes.json` (~250KB) y listo.

**Por qué.** Los recorridos de las líneas cambian raramente (semanas/meses). El build no necesita red. El deploy se vuelve determinista.

### ADR-03 · PluckSynth (Karplus–Strong) para el sonido

**Decisión.** Cada línea dispara un `Tone.PluckSynth` con su nota pentatónica asignada.

**Por qué.** Karplus–Strong es el algoritmo clásico de síntesis de cuerdas pulsadas. Suena exactamente a lo que el proyecto promete: una cuerda siendo punteada. Coherencia estética entre código y audio.

### ADR-04 · Interpolación client-side

**Decisión.** El feed se actualiza cada ~30-60s, pero animamos la posición de cada bondi a 30fps con smoothing exponencial hacia el "target" reportado.

**Por qué.** Si el bondi teleporteara entre updates, rompería la ilusión de tiempo real. Con smoothing, los bondis "se deslizan" por las cuerdas y el pluck se dispara cuando el progreso cruza un umbral — no cuando llega el paquete HTTP. Experiencia continua.

### ADR-05 · 20 líneas curadas, no todas

**Decisión.** 20 líneas troncales de CABA (60, 152, 29, 7, 39, 132, 12, 59, 61, 68, 92, 101, 108, 140, 24, 67, 151, 10, 5, 111).

**Por qué.** Hay ~140 líneas y ~591 variantes. Mostrar todas es caos visual y sonoro. Estas 20 son las más reconocibles, cubren los corredores importantes y se cruzan entre sí creando intersecciones sonoras interesantes.

### ADR-06 · SVG, no Canvas ni WebGL

**Decisión.** Toda la visualización en SVG con Framer Motion.

**Por qué.** 20 polylines + ~200-400 bondis + pluck rings. Volumen manejable para SVG, con la ventaja de que CSS filters (`drop-shadow` neón) + animación declarativa salen gratis. Canvas sería más eficiente pero más código. WebGL sería overkill.

### ADR-07 · Pentatónica mayor

**Decisión.** 15 notas en pentatónica mayor C (C3 a A5) distribuidas entre las 20 líneas.

**Por qué.** Mismo razonamiento que en el capítulo 1. Las líneas no se coordinan entre sí; la pentatónica garantiza consonancia por construcción para cualquier combinación simultánea.

## Archivos críticos

- [`app/api/positions/route.ts`](../app/api/positions/route.ts) — Proxy server-side
- [`lib/projection.ts`](../lib/projection.ts) — Proyección geo + snap a polyline
- [`lib/sonify.ts`](../lib/sonify.ts) — Motor de audio (PluckSynths por línea)
- [`lib/curated-lines.ts`](../lib/curated-lines.ts) — Mapeo línea → nota + color
- [`components/strings-map.tsx`](../components/strings-map.tsx) — SVG + interpolación + detección de pluck
- [`scripts/build-routes.ts`](../scripts/build-routes.ts) — Pipeline GTFS → JSON

## Limitaciones

- El feed GCBA no publica a frecuencia constante. Algunos vehículos reportan cada 10s, otros cada 60s. Ignoramos vehículos con GPS a >80px de su ruta (datos ruidosos).
- El `speed` reportado a veces es 0 aunque el vehículo se mueva (sensor trabado). No distinguimos estados "en parada" vs "ruido".
- Las 20 líneas son solo CABA. Líneas interjurisdiccionales quedan afuera por scope.
- Sin persistencia histórica. No guardamos nada, cada usuario ve el presente.
