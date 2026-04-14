"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Play, Pause, Volume2, VolumeX } from "lucide-react";
import { StringsMap } from "./strings-map";
import { ConductorEngine } from "@/lib/sonify";
import { CURATED_LINES } from "@/lib/curated-lines";
import { cn } from "@/lib/cn";

interface Props {
  routes: {
    generatedAt: string;
    source: string;
    lines: Array<{
      routeShortName: string;
      note: string;
      color: string;
      description: string;
      shape: Array<[number, number]>;
      bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
    }>;
    globalBbox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  };
}

export function PlayerShell({ routes }: Props) {
  const engineRef = useRef<ConductorEngine | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  const [vehicleCount, setVehicleCount] = useState(0);
  const [lastPluckLine, setLastPluckLine] = useState<string | null>(null);

  useEffect(() => {
    engineRef.current = new ConductorEngine(CURATED_LINES);
    return () => engineRef.current?.stop();
  }, []);

  const togglePlay = useCallback(async () => {
    if (!playing) {
      await engineRef.current?.start();
      setPlaying(true);
    } else {
      engineRef.current?.stop();
      engineRef.current = new ConductorEngine(CURATED_LINES);
      setPlaying(false);
    }
  }, [playing]);

  const toggleMute = useCallback((lineShort: string) => {
    setMuted((prev) => {
      const next = { ...prev, [lineShort]: !prev[lineShort] };
      engineRef.current?.setMuted(lineShort, next[lineShort]);
      return next;
    });
  }, []);

  const handlePluck = useCallback((lineShort: string) => {
    setLastPluckLine(lineShort);
    setTimeout(() => {
      setLastPluckLine((prev) => (prev === lineShort ? null : prev));
    }, 500);
  }, []);

  return (
    <div className="grid md:grid-cols-[1fr_320px] gap-0">
      <div className="relative">
        <StringsMap
          routes={routes}
          playing={playing}
          muted={muted}
          engineRef={engineRef}
          onPluck={handlePluck}
          onVehiclesUpdate={setVehicleCount}
        />
        {!playing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={togglePlay}
              className="rounded-full bg-amber-400 text-black px-8 py-5 text-xl font-semibold flex items-center gap-3 shadow-[0_0_40px_rgba(251,191,36,0.4)]"
            >
              <Play size={24} />
              Escuchar la ciudad
            </motion.button>
          </div>
        )}
      </div>

      <aside className="border-l border-[var(--color-border)] bg-[var(--color-bg-soft)] flex flex-col">
        <div className="p-5 border-b border-[var(--color-border)] flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-[var(--color-muted)]">
              En circulación
            </div>
            <div className="text-2xl font-bold font-mono mt-1">
              {vehicleCount}{" "}
              <span className="text-sm text-[var(--color-muted)] font-normal">bondis</span>
            </div>
          </div>
          <button
            onClick={togglePlay}
            aria-label={playing ? "Pausar" : "Reproducir"}
            className={cn(
              "p-3 rounded-full transition",
              playing ? "bg-amber-400 text-black" : "bg-white/10 hover:bg-white/20"
            )}
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {routes.lines.map((line) => {
            const isMuted = muted[line.routeShortName];
            const isPlucking = lastPluckLine === line.routeShortName;
            return (
              <motion.div
                key={line.routeShortName}
                animate={{
                  backgroundColor: isPlucking ? `${line.color}22` : "rgba(255,255,255,0.02)",
                  scale: isPlucking ? 1.015 : 1,
                }}
                transition={{ duration: 0.25 }}
                className="rounded px-3 py-2 flex items-center gap-3 border border-transparent"
                style={{ borderLeft: `3px solid ${isMuted ? "transparent" : line.color}` }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold font-mono">{line.routeShortName}</span>
                    <span className="text-[10px] font-mono text-[var(--color-muted)]">
                      {line.note}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--color-muted)] truncate">
                    {line.description}
                  </div>
                </div>
                <button
                  onClick={() => toggleMute(line.routeShortName)}
                  className="text-[var(--color-muted)] hover:text-white"
                  aria-label={isMuted ? "Reactivar" : "Silenciar"}
                >
                  {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
              </motion.div>
            );
          })}
        </div>

        <div className="p-4 border-t border-[var(--color-border)] text-[10px] font-mono text-[var(--color-muted)] space-y-1">
          <div>Fuente: API Transporte GCBA · CC-BY 2.5 AR</div>
          <div>Poll cada 30s · interpolación 30fps</div>
        </div>
      </aside>
    </div>
  );
}
