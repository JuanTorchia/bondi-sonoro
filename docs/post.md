---
title: "Bondi Sonoro: bitácora de un experimento con datos reales, música generativa y la mecánica de MTA.me"
slug: "colectivos-buenos-aires-tiempo-real-sonificacion-gtfs-rt"
excerpt: "Del GTFS estático de trenes al tiempo real de colectivos. Un recorrido por las decisiones, los errores, los rediseños, y por qué un pluck que no sonaba fue la clave para entender todo el sistema."
---

# Bondi Sonoro: bitácora de un experimento con datos reales, música generativa y la mecánica de MTA.me

> **Demo en vivo**: [bondi-sonoro.vercel.app](https://bondi-sonoro.vercel.app)
> **Código**: [github.com/JuanTorchia/bondi-sonoro](https://github.com/JuanTorchia/bondi-sonoro)
> **Capítulo anterior (trenes, horarios estáticos)**: [amba-trenes-sonoros.vercel.app](https://amba-trenes-sonoros.vercel.app)

---

## Por qué este post es más largo que el anterior

Cuando publiqué [AMBA Trenes Sonoros](https://juanchi.dev/blog/datos-abiertos-transporte-creatividad-datos-publicos-trenes-buenos-aires), cerré diciendo algo que ahora me resulta premonitorio:

> "Si el Ministerio abre el feed en tiempo real, cambiar la fuente son 10 líneas de código."

Spoiler: no son diez. Son varios miles. Y entre medio hay decisiones arquitectónicas, bugs raros, un post-mortem de un deploy que se rompió en Vercel por un `PolySynth<any>`, dos reescrituras completas del motor de sonificación, y un momento exacto donde lo que sonaba como metrónomo se transformó en música.

Este post es la **bitácora completa** del capítulo 2. Quiero contar no solo qué hice sino qué intenté, qué salió mal, y por qué las decisiones salieron como salieron. Si alguna vez pensaste que un proyecto "creativo" era solo poner bonito un output, esto es lo contrario: es arquitectura con todo.

---

## Arrancar: cazando los datos

Lo primero que había cambiado desde el post de trenes era que un lector me había contestado:

> "Con los colectivos sí hay tiempo real. Fijate."

Fui a fijarme. Termino en [api-transporte.buenosaires.gob.ar](https://api-transporte.buenosaires.gob.ar/). Resulta que el Gobierno de la Ciudad publica, desde hace años, una **API pública de transporte** con:

- Posiciones GPS **en tiempo real** de todos los colectivos de CABA y AMBA.
- Predicciones de arribo por parada.
- Alertas operativas.
- GTFS estático con recorridos oficiales.
- GTFS-RT completo (feed protobuf).

La rareza: Google Maps y Moovit la usan en producción, pero fuera del mundo transit-tech casi nadie parece construir cosas nuevas sobre ella. La fricción es mínima: te registrás, te mandan un `client_id` y `client_secret` gratuitos, y listo.

Un primer request crudo al endpoint `vehiclePositionsSimple`:

```bash
curl "https://apitransporte.buenosaires.gob.ar/colectivos/vehiclePositionsSimple?client_id=XXX&client_secret=YYY"
```

Respuesta: **1,1 MB de JSON, 3.197 vehículos activos**. Cada uno con:

```json
{
  "route_id": "764",
  "latitude": -34.78668,
  "longitude": -58.249,
  "speed": 9.72,
  "timestamp": 1776129272,
  "id": "1881",
  "direction": 0,
  "agency_name": "MICRO OMNIBUS QUILMES S.A.C.I. Y F.",
  "agency_id": 72,
  "route_short_name": "159C",
  "trip_headsign": "a Est. Lanus x Gimnasia"
}
```

Tenía los datos. Ahora había que decidir qué contar con ellos.

---

## La inspiración, revisitada

[*Conductor*, de Alexander Chen](http://mta.me/), de 2011, es la referencia inevitable. Cada línea del subte de NY se dibuja como una cuerda estirada entre estaciones. Cuando un tren parte de una estación, esa estación "tira" de la cuerda que lo conecta con la siguiente — la cuerda vibra, se escucha una nota, y el siguiente tren responde en otro lado de la red.

El efecto colectivo es música emergente: nadie la compone, sale del tráfico. Y lo más hermoso es que **los cruces importan**. Cuando dos líneas se encuentran en un transbordo, ambas cuerdas se relacionan. Hay contrapunto sin partitura.

Decidí dos cosas antes de escribir una línea de código:

1. **Vuelvo al aesthetic original**. Cuerdas, no puntos. Cuerdas que vibran. Cuerdas que suenan cuando otras las cruzan.
2. **Hacer que se sienta como un juego**. Fondo negro, neón, scanlines sutiles. Nada de mapas tipo Google. **El mapa es un instrumento, no un GPS**.

---

## La primera decisión que define todo el resto

Podría haber hecho la app como una SPA pura, bajando datos desde el browser con las credenciales expuestas. Mucha gente lo hace. Mal.

El razonamiento:

- Las credenciales del GCBA son gratuitas pero personales. Exponerlas en el cliente las convierte en potenciales víctimas de abuso —aunque sea accidental—. Un proxy server-side las mantiene en una sola instancia.
- El feed crudo pesa 1,1 MB con datos de colectivos del AMBA entero. Yo solo quería CABA. Si el cliente baja el feed completo, tiro banda ancha al aire.
- El polling desde muchos browsers al mismo upstream concentraría carga al GCBA. Con un proxy + cache, mil usuarios míos son uno para ellos.

Entonces: **Next.js con App Router y un Route Handler como proxy**. El cliente le pega a `/api/positions`, y el servidor es el único que conoce las credenciales, filtra el payload, y cachea.

```ts
// app/api/positions/route.ts
export const revalidate = 30;

export async function GET() {
  const url = `https://apitransporte.buenosaires.gob.ar/colectivos/vehiclePositionsSimple?client_id=${process.env.BA_TRANSPORT_CLIENT_ID}&client_secret=${process.env.BA_TRANSPORT_CLIENT_SECRET}`;

  const res = await fetch(url, { next: { revalidate: 30 } });
  const upstream: UpstreamVehicle[] = await res.json();

  const filtered = upstream
    .filter(v => CURATED_PREFIXES.has(prefixOf(v.route_short_name)))
    .map(v => ({
      id: v.id,
      lineShort: prefixOf(v.route_short_name),
      lat: v.latitude,
      lon: v.longitude,
      speed: v.speed,
      direction: v.direction,
      headsign: v.trip_headsign,
      timestamp: v.timestamp,
    }));

  return NextResponse.json(
    { generatedAt: Date.now(), vehicles: filtered },
    { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } }
  );
}
```

Lo que sale del proxy ya no pesa 1,1 MB, pesa ~30 KB. El `revalidate: 30` combinado con `s-maxage=30` hace que Next cachee la respuesta en Vercel Edge durante 30 segundos, así que el GCBA recibe mi fetch una vez cada 30 segundos **sin importar cuántos usuarios tenga**.

## Las rutas: GTFS estático y el zip de 200 MB

El feed en tiempo real da posiciones, pero no dibuja recorridos. Para tener las "cuerdas", necesito los `shapes.txt` del GTFS estático de CABA.

El dataset vive en [data.buenosaires.gob.ar/dataset/colectivos-gtfs](https://data.buenosaires.gob.ar/dataset/colectivos-gtfs). Un zip con `routes.txt`, `trips.txt`, `shapes.txt`, etcétera. Lo bajo.

```bash
curl -L -o /tmp/colectivos.zip "https://cdn.buenosaires.gob.ar/.../colectivos-gtfs.zip"
# 209 MB
```

**Doscientos nueve megas**. Correrlo en cada build de Vercel sería una pésima idea. Además es semi-estático: los recorridos cambian raramente. Decisión:

- Corro el parser manualmente en mi máquina con `pnpm gtfs:fetch`.
- El script extrae, simplifica a ~200 puntos por línea (Douglas-Peucker lite), proyecta a las líneas que me interesan, y escribe `data/routes.json` (~250 KB).
- El JSON queda **committeado al repo**.
- Vercel lee ese JSON y no toca internet para construir el sitio.

Esto tiene un nombre: **"datos como build artifact"**. Cuando la fuente cambia lento y la app cambia rápido, no tiene sentido que el build dependa de la red.

### Primer bug que no esperaba

Mi lista curada tenía 20 líneas icónicas: 60, 152, 29, 7, 39, 132, etc. Corro el parser la primera vez:

```
[routes] no encontré route_id para línea 60
[routes] no encontré route_id para línea 152
[routes] no encontré route_id para línea 29
...
```

¿Cómo? Grep al `routes.txt`:

```
"152","16","21A","JNAMBA021","Ejercito de los Andres - Rotonda Dardo Rocha Tigre",3
```

El `route_short_name` real es `21A`, `96AG`, `621R9`, etc. **Son IDs de variante/ramal**. La "línea 60" en el sentido porteño de la palabra se divide en docenas de sub-rutas con sufijos. El nombre humano "60" no existe como tal.

Un `grep` más cuidadoso muestra que las variantes siguen el patrón `<número><letra opcional>`:

```
10A  15A  17A  19A  20A  20B  23A  24A  24B  24C
29A  29B  29C  34A  37A  39A  39B  39F  42A
44A  45A  46A  50A  53A  53B  55A  56A  59A  59B  59D
60C  60F  60G  61A  64A  65A  67A  68A  68B
92A  92C  92D  101A  101B  101C  105A  108A
111B  111D  111E  132A  132B  132C  140A  140B  140C
151A  152A  152B  152C  160A
```

Arreglo el matcher: para una línea curada "152" busco cualquier `route_short_name` que matchee `/^152[A-Z]?$/`. Tomo la primera variante que tenga shape asociada. Resultado:

```
[routes] ✓ 60: 201 puntos
[routes] ✓ 152: 201 puntos
[routes] ✓ 29: 201 puntos
...
[routes] ✓ parseado: 20/20 líneas
```

Data cargada, listo para el segundo acto.

---

## Musicalizar la ciudad

Necesitaba decidir **qué nota toca cada línea**. Dos reglas de oro:

### Regla 1: Pentatónica mayor

Los bondis no se coordinan. Cada línea dispara notas independientemente. Si uso una escala cromática (con semitonos), la probabilidad de disonancia explota con cada bondi simultáneo.

La **pentatónica mayor** (C, D, E, G, A) no tiene ningún intervalo de semitono entre sus notas. Cualquier combinación simultánea suena consonante. Es el mismo truco que usan los xilofones de los jardines de infantes: "no importa cómo golpees, nunca suena feo".

En lenguaje de sistemas distribuidos: **si no podés coordinar los productores, diseñás el protocolo para que cualquier mensaje sea válido**. La pentatónica es el protocolo que elimina una categoría entera de bugs musicales por diseño.

### Regla 2: Karplus-Strong

Tone.js tiene muchos sintetizadores. Elegí `PluckSynth` porque implementa el algoritmo **Karplus-Strong**, la primitiva clásica de síntesis de cuerda pulsada. Matemáticamente es un delay line con feedback filtrado. Lo importante: **suena exactamente a una cuerda siendo punteada**.

```ts
// lib/sonify.ts
const pluck = new Tone.PluckSynth({
  attackNoise: 0.8,
  dampening: 3500,
  resonance: 0.9,
});

// cuando el bondi cruza:
pluck.triggerAttack(note);
```

Cada línea tiene su propio `PluckSynth` conectado a un reverb compartido. La coherencia estética —código, audio, visual— empieza por elegir bien las primitivas.

---

## El primer intento: bondis como metrónomos

Primera versión: dibujé las 20 cuerdas en SVG, posicioné cada bondi sobre su polyline más cercana, y cada vez que un bondi "avanzaba" lo suficiente, punteaba su propia cuerda.

```ts
// pseudo
if (bondiProgressed > THRESHOLD) {
  pluck(bondi.line, note);
}
```

Le di play. Resultado: **silencio casi absoluto, y cada 30 segundos un ruido molesto**.

¿Qué pasaba? Dos bugs yuxtapuestos:

1. El umbral se comparaba por-frame, pero el smoothing que movía el bondi hacia su nueva posición avanzaba 3,5% del diff por frame. Nunca superaba el umbral de 0,5% en un solo frame.
2. Cuando llegaba el poll cada 30s, el `serverProgress` saltaba de golpe → se acumulaba ese 0,5% en un solo frame → sonaban 20 bondis a la vez → un acorde gigante y después silencio.

Era un metrónomo, no música.

### Fix intermedio: acumulación por vehículo

Primera pasada: en vez de comparar con el frame anterior, **compará con el último pluck de ESE bondi**. Que se acumulen las pequeñas transiciones.

```ts
const sinceLastPluck = Math.abs(state.progress - lastPluckProgress.get(state.id));
if (sinceLastPluck > PLUCK_DELTA) {
  pluck(...);
  lastPluckProgress.set(state.id, state.progress);
}
```

Mejor. Ya sonaba. Pero todavía en bursts cada 30s. Y me molestaba otra cosa: **cada bondi tocaba su propia cuerda**, que era el comportamiento inverso al que quería. Yo quería cruces.

---

## El momento "ajá": intersecciones

Releí con cuidado cómo funciona Conductor. La cuerda no suena por el movimiento propio, suena **cuando otra la cruza**. Un tren en la línea 4 pasando por la estación donde cruza la línea N puntea la cuerda N. La línea propia no hace nada. La música es **producto de la red**, no de cada línea por separado.

Eso cambia todo. Significa que:

1. Necesito **precomputar las intersecciones** entre todas las cuerdas.
2. Cuando un bondi avanza y su posición cruza un punto de intersección, **pluckeo la OTRA línea** en ese punto, no la propia.

Implementación:

```ts
// lib/intersections.ts

export function buildIntersectionIndex(lines) {
  const byLine = new Map<string, Intersection[]>();

  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const A = lines[i];
      const B = lines[j];
      // Para cada par de segmentos (A[a], A[a+1]) x (B[b], B[b+1])
      // calculamos intersección 2D. Si existe, guardamos:
      //   - progreso sobre A donde ocurre
      //   - progreso sobre B donde ocurre
      //   - punto XY en pantalla
      //   - referencia cruzada: cuando A cruza, suena B
      //                         cuando B cruza, suena A
    }
  }

  // Ordenamos las intersecciones de cada línea por progreso
  // para poder hacer range-scan O(log n) cuando un bondi avanza.
  for (const arr of byLine.values()) arr.sort((a, b) => a.progress - b.progress);
  return { byLine };
}
```

Para 20 líneas × 20 líneas / 2 = 190 pares, cada uno con ~200×200 combinaciones de segmento = ~7,6M operaciones. Corre en ~50ms al montar el componente. Después se usa miles de veces por segundo con un simple range scan.

En cada frame del tick:

```ts
const crossed = intersectionsCrossed(index, bondiLine, previousProgress, newProgress);
for (const hit of crossed) {
  // hit.other es la OTRA línea. La pluckeamos a ella.
  pluck(hit.other, noteOf(hit.other));
}
```

Le di play. Ahí sonó como quería. Por primera vez el mapa se sintió como un instrumento.

---

## El siguiente problema: el pulso del poll

Pero todavía había **bursts cada 30 segundos**. Traza mental:

- Entre polls: los bondis "avanzan" muy poco (smoothing lento).
- Llega el poll: `serverProgress` salta a la nueva posición.
- El smoothing ahora tiene un diff gigante → en el siguiente frame se mueve MUCHO → cruza muchas intersecciones → muchos plucks a la vez.

El bug era de diseño: **estaba usando la corrección de posición como si fuera movimiento**. Son dos cosas distintas.

La solución fue separar en dos fases:

```ts
// FASE 1: avance real simulado, basado en la speed reportada por el feed.
// Esta es la única fase que dispara plucks.
const effectiveSpeed = Math.max(state.speed, DEFAULT_SPEED_MS);
const progressDelta = (effectiveSpeed * dt) / pLine.lengthMeters;
const sign = state.direction === 1 ? -1 : 1;
const simulatedProgress = state.progress + sign * progressDelta;

const crossed = intersectionsCrossed(index, line, state.progress, simulatedProgress);
// ...fire plucks...

// FASE 2: corrección hacia serverProgress. Silenciosa — no dispara plucks.
const drift = state.serverProgress - simulatedProgress;
state.progress = simulatedProgress + drift * CORRECTION_RATE;
```

Esto tiene dos efectos hermosos:

1. **Los bondis se mueven continuo** aunque el poll tarde 30 segundos. La simulación los avanza frame a frame según su velocidad reportada y la longitud real de su ruta.
2. **Cuando llega el poll, la corrección es silenciosa**. El bondi se re-centra hacia la posición real en 2% por frame, sin disparar plucks. La música sigue fluyendo.

Pasó de metrónomo a concierto.

---

## El último empujón: densidad

Ya sonaba bien, pero con 9-20 bondis activos todavía se sentía ralo. El usuario me lo dijo: "suena poco, se escucha cada 10-15 segundos".

Dos movidas finales:

### Duplicar líneas: de 20 a 40

Más líneas = más intersecciones con los mismos bondis. Agregué 20 líneas troncales más (15, 17, 19, 20, 23, 26, 34, 37, 42, 44, 45, 46, 50, 53, 55, 56, 64, 65, 105, 160). El archivo `data/routes.json` creció de 250 KB a ~500 KB — sigue siendo un peso mínimo.

### Auto-pluck como bajo tumbao

Mientras las intersecciones aportan **melodía**, le agregué al sistema un pluck propio cada 1,2% de recorrido. Intensidad baja (0,25-0,55 vs 0,5-1 de los cruces). Se escucha como un **bajo suave**, un pulso constante sobre el cual las intersecciones hacen figuras.

```ts
const advancedSinceSelf = Math.abs(simulatedProgress - state.lastSelfPluckProgress);
if (advancedSinceSelf > SELF_PLUCK_INTERVAL) {
  if (canPluck(state.lineShort, now, 260)) {
    const intensity = Math.max(0.25, Math.min(0.55, state.speed / 14));
    engineRef.current?.pluck(state.lineShort, note, intensity);
  }
  state.lastSelfPluckProgress = simulatedProgress;
}
```

Y al final, un **rate limit global**: máximo 12 plucks por segundo (rolling window de 1 segundo). Si hay una tormenta de cruces simultáneos, se recortan los excedentes. La música queda densa pero legible.

---

## La arquitectura final, en un diagrama

```
┌──────────────────────────────┐
│ GTFS estático (GCBA)          │   zip 209MB, se baja
│  routes / trips / shapes      │   UNA vez con pnpm gtfs:fetch
└──────────┬────────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ scripts/build-routes.ts       │   Simplifica a 200 pts
│  matcher por prefijo numérico │   por línea (40 líneas)
└──────────┬────────────────────┘
           │ escribe JSON
           ▼
┌──────────────────────────────┐
│ data/routes.json (~500 KB)    │   Committeado al repo
└──────────┬────────────────────┘
           │ import estático
           ▼
┌──────────────────────────────┐        ┌────────────────────────────┐
│ app/page.tsx (RSC)            │────────▶ /api/positions (Route Handler) │
└──────────┬────────────────────┘        │  (proxy server-side con creds) │
           │                              └────────────┬───────────────────┘
           ▼                                           │ cada 30s, con cache
┌──────────────────────────────┐                      ▼
│ PlayerShell (Client)          │         ┌────────────────────────────┐
│  ├─ ConductorEngine (Tone.js) │◀──fetch──│ apitransporte.buenosaires  │
│  ├─ StringsMap (SVG)          │ 30s     │ vehiclePositionsSimple     │
│  └─ IntersectionIndex (memo)  │         └────────────────────────────┘
└──────────┬────────────────────┘
           │
           ├─ simulación 30fps por speed reportada
           ├─ detección de cruces → pluck línea cruzada
           ├─ auto-pluck cada 1.2% avance propio
           ├─ rate limit global 12 plucks/s
           └─ corrección silenciosa hacia serverProgress
```

---

## Archivos y líneas clave

Si querés leer el código, te dejo los puntos calientes:

- [**`lib/intersections.ts`**](https://github.com/JuanTorchia/bondi-sonoro/blob/main/lib/intersections.ts) — la mecánica MTA.me: pre-computa todos los cruces, expone `intersectionsCrossed(index, line, from, to)`.
- [**`lib/projection.ts`**](https://github.com/JuanTorchia/bondi-sonoro/blob/main/lib/projection.ts) — `makeProjector` (lat/lon → SVG), `nearestOnPolyline` (snap bondi a su ruta), `polylineMeters` (largo real en metros para calibrar la simulación).
- [**`lib/sonify.ts`**](https://github.com/JuanTorchia/bondi-sonoro/blob/main/lib/sonify.ts) — `ConductorEngine`, un `PluckSynth` por línea, reverb compartido, mute/volumen.
- [**`components/strings-map.tsx`**](https://github.com/JuanTorchia/bondi-sonoro/blob/main/components/strings-map.tsx) — el corazón: polling, simulación, detección de cruces, render SVG, wobble visual, pluck rings.
- [**`app/api/positions/route.ts`**](https://github.com/JuanTorchia/bondi-sonoro/blob/main/app/api/positions/route.ts) — el proxy con las credenciales.

Docs pedagógicos completos en [**`/docs/arquitectura.md`**](https://github.com/JuanTorchia/bondi-sonoro/blob/main/docs/arquitectura.md).

---

## Errores reales, con commits

Lista honesta de lo que rompió durante el desarrollo:

| Bug | Síntoma | Fix | Commit |
|---|---|---|---|
| React 19 RC + framer-motion | Deploy Vercel roto en `npm install` | Pasar a React 19 estable + `.npmrc legacy-peer-deps=true` | [trenes: `fix(deps)`](https://github.com/JuanTorchia/amba-trenes-sonoros/commit/7375d80) |
| `Tone.PolySynth<MetalSynth>` no asignable | TypeScript error en build | Tipar el voice como `PolySynth<any>` | [trenes: `fix(sonify)`](https://github.com/JuanTorchia/amba-trenes-sonoros/commit/2c60562) |
| GTFS fetch sin timeout | Build de Vercel colgado | `AbortController` + timeout 15s | [trenes: `fix(build-gtfs)`](https://github.com/JuanTorchia/amba-trenes-sonoros/commit/94a1db6) |
| URL de GTFS 404 | `[routes] respondió 404` | Seguir redirects con `curl -L`, descubrir URL real del CDN | [bondi: `feat:...`](https://github.com/JuanTorchia/bondi-sonoro) |
| Líneas no matchean | `no encontré route_id para línea 60` | Matcher por prefijo numérico + sufijo opcional | idem |
| Plucks no disparan | Silencio total con pocos bondis | Comparar con último-pluck-por-bondi, no frame anterior | idem |
| Bursts cada 30s | 20 notas juntas al llegar el poll | Separar simulación (→plucks) de corrección (→silencio) | idem |
| Música ralo | Poco denso con ~20 bondis | 40 líneas + auto-pluck + rate limit global | idem |

Cada bug es una lección. Los dejo visibles en el repo: commit por commit, no hay trampa.

---

## Lo que aprendí en los dos capítulos

**Capítulo 1 (Trenes Sonoros)** me enseñó que cuando los datos ideales no existen, el trabajo es **adaptar el problema al material disponible y decirlo en voz alta**. Hice una pieza honesta con horarios programados.

**Capítulo 2 (Bondi Sonoro)** me enseñó que cuando los datos ideales sí existen, el trabajo es **decidir qué historia contar con ellos**. Y que las decisiones arquitectónicas son a la vez estéticas: dónde corre el código, cómo fluyen los datos, qué timbre elegís, qué escala usás, todo es parte de la misma obra.

Los dos capítulos son parte del mismo oficio: **leer los datos que hay y decidir qué contar con ellos**. A veces te toca trabajar con lo poco y hacerlo sonar lleno; a veces te toca trabajar con lo mucho y hacerlo sonar con sentido.

---

## Qué queda abierto

- **v3 con shapes vivos**: el GCBA también publica el GTFS-RT completo en formato protobuf, con más señal (retrasos, cancelaciones). Consumirlo como protobuf en vez de JSON simplificado daría acceso a eventos que hoy no sonifico.
- **Intersecciones con resonancia simpática**: cuando la línea A puntea la B, que la B puntee levemente a la C si están muy cerca. Un segundo nivel de reverberación emergente.
- **Grabación + exportación**: que el usuario apriete "grabar" y genere un WAV de N minutos como pieza musical única del momento exacto de la ciudad.
- **Otras ciudades**: Rosario, Córdoba, Mendoza también tienen GTFS estáticos. Si alguna vez publican un GTFS-RT público, el código está listo para ir.
- **Modo "una sola línea"**: aislar el 60 o el 152 y escuchar su canción propia a lo largo del día.

Todo está en el backlog mental.

---

## Reflexión final

Este proyecto no me dio plata. No me dio likes de Twitter. Tardó más horas de las que debería admitir. Pero hay algo que saqué en limpio y que se aplica al laburo serio también:

> **Los proyectos más instructivos son los que no tienen un cliente que los pida.**

Cuando no hay entregable, no hay scope creep, no hay "ya ponele que ande". Hay solo vos, el problema, y decisiones que se toman despacio. Este tipo de experimentos es donde uno afila el oficio. Después se usa en laburo real.

Si programás, clonate el repo, probá cambiar la escala, sumá una línea, fork para tu ciudad. El código es MIT, los datos son del Estado argentino, la música es colectiva, y el aprendizaje es tuyo.

---

**Links útiles**

- 🎧 Demo: [bondi-sonoro.vercel.app](https://bondi-sonoro.vercel.app)
- 💻 Código: [github.com/JuanTorchia/bondi-sonoro](https://github.com/JuanTorchia/bondi-sonoro)
- 🚂 Capítulo 1 (trenes): [amba-trenes-sonoros.vercel.app](https://amba-trenes-sonoros.vercel.app) · [repo](https://github.com/JuanTorchia/amba-trenes-sonoros)
- 📡 API GCBA: [apitransporte.buenosaires.gob.ar/console/](https://apitransporte.buenosaires.gob.ar/console/)
- 📜 Datos de rutas: CC-BY 2.5 AR / Gobierno de la Ciudad
- 🏙️ Referencia inspiradora: [Conductor (mta.me)](http://mta.me/) de Alexander Chen
- 🎼 Tone.js: [tonejs.github.io](https://tonejs.github.io/)
- 🧮 @turf/turf: [turfjs.org](https://turfjs.org/)
