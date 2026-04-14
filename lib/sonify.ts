/**
 * Sonificación — cada línea es una cuerda punteada.
 *
 * Usamos `Tone.PluckSynth` que implementa el algoritmo **Karplus–Strong**,
 * el clásico modelo físico de cuerda pulsada. Es la primitiva sonora más
 * cercana al aesthetic de MTA.me (Conductor, de Alexander Chen) — literalmente
 * suena como una cuerda vibrando.
 *
 * Cada línea tiene:
 *   - Una nota asignada (pentatónica mayor, misma filosofía que trenes-sonoros
 *     para evitar disonancias entre líneas que no se coordinan).
 *   - Un `PluckSynth` propio conectado a un reverb compartido.
 *   - Un volumen modulable por la UI.
 *
 * El disparador del sonido NO es polling — es cada vez que un bondi avanza
 * a lo largo de su polyline. La UI detecta el avance y llama a `pluck()`
 * con la línea y una intensidad (basada en la velocidad reportada).
 */

"use client";

import * as Tone from "tone";
import type { CuratedLine } from "./curated-lines";

type LineVoice = {
  pluck: Tone.PluckSynth;
  volume: Tone.Volume;
  muted: boolean;
};

export class ConductorEngine {
  private voices = new Map<string, LineVoice>();
  private reverb: Tone.Reverb | null = null;
  private masterVolume: Tone.Volume | null = null;
  private started = false;

  constructor(private lines: CuratedLine[]) {}

  async start(): Promise<void> {
    if (this.started) return;
    await Tone.start();

    this.masterVolume = new Tone.Volume(-4).toDestination();
    this.reverb = new Tone.Reverb({ decay: 4, wet: 0.35 }).connect(this.masterVolume);

    for (const line of this.lines) {
      // attackNoise y dampening controlan el carácter: más noise = más "punteo",
      // menos dampening = sustain más largo.
      const pluck = new Tone.PluckSynth({
        attackNoise: 0.8,
        dampening: 3500,
        resonance: 0.9,
      });
      const volume = new Tone.Volume(0);
      pluck.chain(volume, this.reverb);
      this.voices.set(line.routeShortName, { pluck, volume, muted: false });
    }

    this.started = true;
  }

  stop(): void {
    if (!this.started) return;
    for (const voice of this.voices.values()) {
      voice.pluck.dispose();
      voice.volume.dispose();
    }
    this.reverb?.dispose();
    this.masterVolume?.dispose();
    this.voices.clear();
    this.started = false;
  }

  setMuted(lineShort: string, muted: boolean): void {
    const voice = this.voices.get(lineShort);
    if (!voice) return;
    voice.muted = muted;
    voice.volume.mute = muted;
  }

  /**
   * Puntea la cuerda de una línea.
   *
   * @param lineShort "152", "60", etc.
   * @param note      nota a disparar (el caller pasa la asignada a la línea)
   * @param intensity 0..1 — a más velocidad del bondi, más volumen del pluck
   */
  pluck(lineShort: string, note: string, intensity = 1): void {
    if (!this.started) return;
    const voice = this.voices.get(lineShort);
    if (!voice || voice.muted) return;

    // Convertimos intensity a dB relativo. Intensity 0 → muy bajo, 1 → 0dB.
    const db = -18 + intensity * 18;
    voice.pluck.volume.setValueAtTime(db, Tone.now());
    voice.pluck.triggerAttack(note);
  }
}
