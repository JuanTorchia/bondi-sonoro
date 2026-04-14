import { Train, Bus, Radio } from "lucide-react";

export function InfoSection() {
  return (
    <section className="max-w-5xl mx-auto px-6 py-20 space-y-12">
      <div>
        <div className="flex items-center gap-2 text-amber-400 mb-4">
          <Radio size={18} />
          <span className="text-sm uppercase tracking-widest">Capítulo 2 · Serie datos abiertos</span>
        </div>
        <h2 className="text-3xl md:text-4xl font-bold mb-6">De los trenes al tiempo real.</h2>
        <div className="prose prose-invert max-w-none text-[var(--color-muted)] space-y-4 leading-relaxed">
          <p>
            Hace unas semanas hicimos{" "}
            <a
              className="text-amber-400 underline"
              href="https://amba-trenes-sonoros.vercel.app"
            >
              AMBA Trenes Sonoros
            </a>
            : una sonificación de los horarios <em>programados</em> de los ferrocarriles
            argentinos. Fue una decisión arquitectónica honesta — no existía GTFS-RT público
            para trenes, así que sonificamos el horario, no la realidad.
          </p>
          <p>
            Este es el capítulo 2. Acá sí hay tiempo real: el GCBA publica posiciones GPS en
            vivo de los colectivos de Buenos Aires a través de su{" "}
            <a
              className="text-amber-400 underline"
              href="https://apitransporte.buenosaires.gob.ar/console/"
            >
              API Transporte
            </a>
            . Lo que se ve y se escucha acá es — literalmente — el movimiento real de los
            bondis en este momento.
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <InfoCard
          icon={<Bus size={20} />}
          title="Las cuerdas"
          body="Cada línea (60, 152, 132, etc.) se dibuja como su recorrido real. Vienen del GTFS estático: routes.txt + trips.txt + shapes.txt procesado en build-time."
        />
        <InfoCard
          icon={<Radio size={20} />}
          title="El punteo"
          body="Cada ~30 segundos pedimos las posiciones en vivo. Cuando un bondi avanza sobre su cuerda, disparamos un PluckSynth (Karplus–Strong, el mismo algoritmo que modela una cuerda real)."
        />
        <InfoCard
          icon={<Train size={20} />}
          title="La honestidad"
          body="El GCBA actualiza cada ~60s. Entre polls, interpolamos suavemente para que visualmente los bondis se deslicen en vez de teleportarse. Todo cliente, sin trampa."
        />
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-6">
        <h3 className="font-semibold mb-3">Decisiones técnicas clave</h3>
        <ul className="space-y-2 text-sm text-[var(--color-muted)] list-disc pl-5">
          <li>
            <strong className="text-white">Proxy server-side</strong> (Route Handler de Next.js):
            las credenciales del GCBA viven solo en env vars, nunca llegan al browser.
          </li>
          <li>
            <strong className="text-white">Pentatónica mayor</strong> para las 20 líneas curadas:
            cualquier combinación simultánea suena consonante, sin importar qué bondis
            coincidan.
          </li>
          <li>
            <strong className="text-white">@turf + d3-geo</strong> para lo geométrico:
            proyección lat/lon → SVG, snap del bondi a su ruta, longitudes paramétricas.
          </li>
          <li>
            <strong className="text-white">Interpolación 30fps</strong> cliente-side: el feed
            llega cada 30–60s pero la visual y el audio responden continuos.
          </li>
        </ul>
      </div>

      <div className="text-center text-sm text-[var(--color-muted)]">
        <a
          className="text-amber-400 underline"
          href="https://juanchi.dev/blog/colectivos-buenos-aires-tiempo-real-sonificacion-gtfs-rt"
        >
          Leé el post completo con decisiones arquitectónicas, diagramas y código →
        </a>
      </div>
    </section>
  );
}

function InfoCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-5">
      <div className="text-amber-400 mb-3">{icon}</div>
      <h3 className="font-semibold mb-2">{title}</h3>
      <p className="text-sm text-[var(--color-muted)] leading-relaxed">{body}</p>
    </div>
  );
}
