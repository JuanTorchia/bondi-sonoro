---
title: "Cuerdas que suenan con el tráfico: los colectivos de Buenos Aires en tiempo real"
slug: "colectivos-buenos-aires-tiempo-real-sonificacion-gtfs-rt"
excerpt: "Capítulo 2 de la serie sobre datos abiertos. Si el primero fue una simulación honesta con horarios de trenes, este es tiempo real puro: cada colectivo de CABA puntea una cuerda cuando se mueve."
---

# Cuerdas que suenan con el tráfico: los colectivos de Buenos Aires en tiempo real

> **Demo en vivo**: [bondi-sonoro.vercel.app](https://bondi-sonoro.vercel.app)
> **Código**: [github.com/JuanTorchia/bondi-sonoro](https://github.com/JuanTorchia/bondi-sonoro)
> **Capítulo anterior**: [AMBA Trenes Sonoros](https://juanchi.dev/blog/datos-abiertos-transporte-creatividad-datos-publicos-trenes-buenos-aires)

---

## De dónde veníamos

Hace un mes publiqué [AMBA Trenes Sonoros](https://juanchi.dev/blog/datos-abiertos-transporte-creatividad-datos-publicos-trenes-buenos-aires): un experimento de sonificación con los horarios GTFS de los ferrocarriles argentinos. Cada tren programado disparaba una nota, el resultado era una pieza generativa que cambiaba según la hora del día.

Fue, a propósito, **una simulación honesta**. El proyecto original que me inspiraba —[*Conductor*, de Alexander Chen](http://mta.me/) para la MTA de Nueva York— usa posiciones GPS en tiempo real: cuando un vagón pasa por una estación, literalmente puntea una cuerda. En Argentina, el GTFS-RT para ferrocarriles no es público. Entonces me adapté a lo disponible, lo dije en voz alta en el post, y armé la versión que se podía hacer.

Un lector del post me contestó algo que no había considerado:

> "¿Y con los colectivos? Eso sí lo tenés en vivo."

Spoiler: tenía razón.

---

## Lo que cambia el juego

El Gobierno de la Ciudad de Buenos Aires publica, desde hace años, una [**API pública de transporte**](https://apitransporte.buenosaires.gob.ar/console/) que usan Google Maps y Moovit en producción. Incluye:

- Posiciones GPS en tiempo real de **todos los colectivos** de CABA y AMBA.
- Predicciones de arribo a parada.
- Alertas operativas.
- GTFS estático con los recorridos oficiales.

Requiere registrarse y obtener un `client_id` y `client_secret` gratuitos. Sin convenios, sin papeles, sin fricción institucional. La rareza es que casi nadie parece usarlo para nada fuera de transit apps.

Un primer request al endpoint `vehiclePositionsSimple` me devolvió 1,1 MB de JSON con **3.197 vehículos activos** en ese momento. Cada uno con `latitude`, `longitude`, `speed`, `route_short_name`, `timestamp` y un `trip_headsign`. Datos vivos, actualizándose al minuto.

Ahí empezó el capítulo 2.

---

## Lo que quería hacer

Una vez que tenés tiempo real, la pregunta ya no es "cómo me adapto" sino "qué historia quiero contar". Decidí dos cosas:

1. **Volver al aesthetic original de MTA.me**: cada línea como una cuerda dibujada en la pantalla. Cuando un colectivo se mueve, la cuerda que recorre se puntea —suena y vibra visualmente—.
2. **Hacerlo parecer un juego**. Fondo negro, neón, scanlines. Nada de mapas realistas tipo Google Maps. El mapa es un instrumento, no un GPS.

---

## La arquitectura, en un diagrama

```
API GCBA (en vivo)
    │ fetch cada 30s (server-side, creds en env)
    ▼
/api/positions  ─ Route Handler de Next.js
    │ filtra a 20 líneas curadas + cache 30s
    ▼
Browser
    ├─ polling cada 30s al proxy
    ├─ interpolación 30fps entre updates
    ├─ detección de avance → pluck sonoro + wobble visual
    └─ render SVG (cuerdas + bondis + pluck rings)
```

Cinco decisiones arquitectónicas que vale la pena desempaquetar.

### 1. Las credenciales nunca llegan al browser

El `client_id` y el `client_secret` del GCBA son gratis, pero gratis no quiere decir que los tiremos a un repo público. Viven en `.env.local` en desarrollo y en variables de entorno en Vercel. El único que las conoce es un **Route Handler de Next.js**:

```ts
// app/api/positions/route.ts
export const revalidate = 30;

export async function GET() {
  const url = `https://apitransporte.buenosaires.gob.ar/colectivos/vehiclePositionsSimple?client_id=${process.env.BA_TRANSPORT_CLIENT_ID}&client_secret=${process.env.BA_TRANSPORT_CLIENT_SECRET}`;
  const res = await fetch(url, { next: { revalidate: 30 } });
  const upstream = await res.json();
  // ... filtrar a líneas curadas, mandar ~20KB al cliente
}
```

El browser hace `fetch("/api/positions")` y listo. Como bonus, el proxy **filtra el payload** al subconjunto de líneas que nos interesa: de 1,1 MB crudos bajamos a ~20–50 KB. Una API pública bien usada puede ser más eficiente que una privada mal usada.

### 2. El GTFS estático se procesa una vez, no en cada build

Los recorridos de cada línea vienen del GTFS estático oficial: `shapes.txt` es un CSV con cientos de miles de filas que describen cada polyline. El zip completo pesa ~200 MB.

Bajarlo en cada deploy de Vercel sería frágil (depende del CDN del GCBA), lento (hay que parsear 100+ MB de CSV) y caro (tiempo de build). La solución:

- Corremos `pnpm gtfs:fetch` manualmente cuando queremos refrescar.
- El script extrae las shapes de las 20 líneas curadas, las simplifica a ~200 puntos cada una, y escribe `data/routes.json` (~250 KB).
- Ese JSON se committea al repo.
- Vercel no necesita red para construir el sitio.

Es un patrón común cuando trabajás con datos abiertos: **la fuente cambia lento, la app cambia rápido, el build no debería depender de la red**.

### 3. PluckSynth — la cuerda como primitiva sonora

Tone.js tiene muchos sintetizadores. Elegí `PluckSynth` porque implementa el algoritmo **Karplus–Strong**, el clásico modelo físico de cuerda pulsada. Matemáticamente es un delay line con feedback filtrado — pero lo que importa es que **suena exactamente a una cuerda siendo punteada**.

Cada línea tiene su propio `PluckSynth` conectado a un reverb compartido. Cuando un colectivo avanza a lo largo de su polyline, llamamos:

```ts
pluck.triggerAttack(note);
```

Y la cuerda suena. La intensidad se deriva del `speed` reportado del bondi: más rápido, punteo más fuerte.

### 4. Interpolación client-side: honesta pero continua

El feed no es literalmente "segundo a segundo". Algunos colectivos reportan cada 10 segundos, otros cada minuto. Si el dot saltara entre updates, rompería la ilusión de tiempo real y además haría que todos los plucks cayeran al mismo tiempo cada ~30s (no sería música, sería un metrónomo).

La solución: **en cada update tenemos una posición "target", y el cliente interpola 30 veces por segundo hacia ella** con smoothing exponencial. El bondi se desliza por la cuerda. El pluck se dispara cuando el *progreso acumulado* cruza un umbral — no cuando llega el paquete HTTP.

```ts
// cada frame
state.progress += (state.targetProgress - state.progress) * 0.035;
if (Math.abs(state.progress - previousProgress) > PLUCK_THRESHOLD) {
  firePluck(state.lineShort, pLine.note, intensity);
}
```

El resultado es audio y video continuos, anclados en datos discretos. Es la diferencia entre *sincronía* y *realismo*: mentimos 33 veces por segundo para que la verdad (el tren se movió) se sienta fluida.

### 5. El map-as-instrument

Es tentador agarrar Mapbox o MapLibre y poner los bondis sobre un basemap real. Descarté la idea. Un mapa con calles y nombres compite visualmente con las cuerdas. El aesthetic de MTA.me es abstracto a propósito: la red de transporte es un instrumento, no un sistema de navegación.

Entonces: fondo negro, sin calles, sin etiquetas. Solo las 20 cuerdas con sus colores propios, los bondis deslizándose, los pluck rings expandiéndose. Scanlines sutiles y vignette para el vibe retro-arcade.

Toda la visualización es SVG puro (no Canvas, no WebGL). Con ~20 polylines + ~400 bondis + algunos pluck rings, SVG anda sobrado y permite efectos `drop-shadow` neón con una línea de CSS. Framer Motion se encarga de las transiciones declarativas.

---

## Lo que se escucha

La pieza depende de la hora:

- **08:00–10:00** (hora pico matutina): densidad máxima. Las 20 cuerdas en actividad, plucks cada segundo, armonía densa.
- **12:00–14:00**: frecuencia media. Cada cuerda se distingue. Se escucha la personalidad de cada nota.
- **18:00–20:00**: pico vespertino. Igual de denso que la mañana pero más "apurado" (velocidad reportada más alta → plucks más fuertes).
- **02:00–05:00**: casi silencio. Un 60 cruzando la ciudad de madrugada suena como un solo de guitarra en un teatro vacío.

Es la ciudad moviéndose, convertida en partitura.

---

## Lo que queda abierto

- **Intersecciones cruzadas**: detectar puntos donde dos cuerdas se cruzan en el mapa y hacer un pluck "simpático" en la cuerda cruzada cuando una vibra fuerte. Como las resonancias entre cuerdas de una guitarra.
- **Modo de una sola línea**: aislar el 60 o el 152 y escuchar su canción propia a lo largo del día.
- **Grabación**: exportar un WAV de N minutos de AMBA en vivo como pieza musical.
- **Otras ciudades**: el código es agnóstico del dataset. Córdoba, Rosario, Mendoza también tienen GTFS abiertos. Fork + nuevo `CURATED_LINES` y tenés tu versión local.
- **Colectivos interjurisdiccionales**: el feed los incluye, nosotros los filtramos por scope. Expandir es cambiar una lista.

---

## Lo que aprendí (otra vez)

Lo mismo que en el capítulo 1, pero en espejo:

> **Cuando los datos ideales existen, la pregunta deja de ser "cómo me adapto" y pasa a ser "qué historia cuento".**

El trabajo de un arquitecto/a de software no es solo resolver restricciones — también es elegir qué hacer cuando las restricciones se levantan. El capítulo 1 fue un ejercicio de resignación honesta. Este fue un ejercicio de libertad creativa sobre una base técnica sólida.

Los dos son parte del mismo oficio: **leer los datos que hay y decidir qué contar con ellos**.

---

**Links útiles**

- 🎧 Demo: [bondi-sonoro.vercel.app](https://bondi-sonoro.vercel.app)
- 💻 Código: [github.com/JuanTorchia/bondi-sonoro](https://github.com/JuanTorchia/bondi-sonoro)
- 🚂 Capítulo 1 (trenes): [amba-trenes-sonoros.vercel.app](https://amba-trenes-sonoros.vercel.app) · [repo](https://github.com/JuanTorchia/amba-trenes-sonoros)
- 📡 API GCBA: [apitransporte.buenosaires.gob.ar/console/](https://apitransporte.buenosaires.gob.ar/console/)
- 🏙️ Proyecto original de NY: [mta.me](http://mta.me/) por Alexander Chen
- 📜 Licencia datos: CC-BY 2.5 AR / Gobierno de la Ciudad de Buenos Aires
