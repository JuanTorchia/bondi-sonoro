import routesData from "@/data/routes.json";
import { PlayerShell } from "@/components/player-shell";
import { InfoSection } from "@/components/info-section";

export default function HomePage() {
  const routes = routesData as unknown as React.ComponentProps<typeof PlayerShell>["routes"];

  return (
    <main className="min-h-screen bg-black">
      <header className="border-b border-[var(--color-border)]">
        <div className="max-w-7xl mx-auto px-6 py-10 md:py-14">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)] mb-3">
            Sonificación en vivo · Buenos Aires
          </p>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-[1.02]">
            Bondi <span className="text-amber-400">Sonoro</span>
          </h1>
          <p className="mt-4 text-base md:text-lg text-[var(--color-muted)] max-w-2xl leading-relaxed">
            Cada línea de colectivo es una cuerda. Cuando un bondi pasa, la cuerda vibra y
            suena. Todo con datos reales, en tiempo real, de la API de Transporte del GCBA.
          </p>
        </div>
      </header>

      <div className="max-w-7xl mx-auto border-b border-[var(--color-border)]">
        <PlayerShell routes={routes} />
      </div>

      <InfoSection />

      <footer className="border-t border-[var(--color-border)] py-8 text-center text-xs text-[var(--color-muted)] font-mono">
        <p>
          <a className="underline hover:text-amber-400" href="https://juanchi.dev">
            juanchi.dev
          </a>
          {"  ·  "}
          <a
            className="underline hover:text-amber-400"
            href="https://github.com/JuanTorchia/bondi-sonoro"
          >
            github
          </a>
          {"  ·  "}
          <a
            className="underline hover:text-amber-400"
            href="https://amba-trenes-sonoros.vercel.app"
          >
            capítulo 1: trenes
          </a>
          {"  ·  "}
          datos: CC-BY 2.5 AR / GCBA
        </p>
      </footer>
    </main>
  );
}
