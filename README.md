# Bondi Sonoro

> Cada línea de colectivo de Buenos Aires es una cuerda. Cuando un bondi avanza, la cuerda vibra y suena. En vivo, con datos reales del GCBA.

**Demo** → https://bondi-sonoro.vercel.app
**Post del proyecto** → https://juanchi.dev/blog/colectivos-buenos-aires-tiempo-real-sonificacion-gtfs-rt
**Capítulo 1 (trenes con horarios estáticos)** → https://github.com/JuanTorchia/amba-trenes-sonoros

---

## Qué es

Una visualización/sonificación en tiempo real de los colectivos de Buenos Aires. Inspirado en [Conductor (MTA.me)](http://mta.me/) de Alexander Chen: las rutas se dibujan como cuerdas y se puntean cuando un colectivo avanza. Usa la [API de Transporte del GCBA](https://apitransporte.buenosaires.gob.ar/console/), que publica posiciones GPS de cada bondi en vivo.

Este es el **capítulo 2** de una serie sobre creatividad con datos abiertos argentinos. El primero ([AMBA Trenes Sonoros](https://github.com/JuanTorchia/amba-trenes-sonoros)) usaba horarios programados porque no había tiempo real disponible para ferrocarriles. Acá sí lo hay, y cambia todo.

## Cómo correrlo local

```bash
pnpm install
cp .env.example .env.local      # completá con tus credenciales del GCBA
pnpm dev                         # http://localhost:3000
```

Credenciales gratis en https://www.buenosaires.gob.ar/desarrollourbano/transporte/apitransporte.

## Refrescar las rutas (GTFS estático)

```bash
pnpm gtfs:fetch
```

Baja el GTFS oficial (~200MB), extrae las shapes de las 20 líneas curadas, escribe `data/routes.json` (~250KB). El JSON queda committeado; solo hace falta refrescarlo si el GCBA publica cambios de recorrido.

## Stack

- **Next.js 15** (App Router)
- **React 19** + TypeScript estricto
- **Tailwind CSS v4**
- **Tone.js** — `PluckSynth` (Karplus–Strong) para el sonido de cuerda pulsada
- **Framer Motion** — wobble de la cuerda + pluck rings
- **@turf/turf** — operaciones geométricas (snap a ruta, distancias)
- **d3-geo** — proyección lat/lon → SVG

## Arquitectura

```
API GCBA (en vivo)
    │ fetch cada 30s (server-side, creds en env)
    ▼
/api/positions  ─ Route Handler
    │ filtra a 20 líneas curadas + revalidate 30s
    ▼
Browser
    ├─ polling cada 30s
    ├─ interpolación 30fps entre updates
    ├─ detección de avance → pluck sonoro + wobble visual
    └─ render SVG (cuerdas + bondis + pluck rings)
```

Detalles arquitectónicos en [`docs/`](docs/).

## Variables de entorno

```
BA_TRANSPORT_CLIENT_ID=...
BA_TRANSPORT_CLIENT_SECRET=...
```

En Vercel: Project Settings → Environment Variables.

## Licencia

MIT. Los datos del GCBA son CC-BY 2.5 AR: atribución visible en el footer de la demo.
