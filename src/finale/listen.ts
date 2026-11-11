// What the finale plays by default: the model chirp alone, trimmed to its audible part (pure; owner fix, most of the
// catalogue snippets were dead space and the chirp was buried in noise). Modelled, and labelled so.
//  - Window (model time, 0 = merger): from where the model enters the band (20 Hz) or 1.5 s before the merger,
//    whichever is shorter; for a neutron star in the pair the full chirp from 20 Hz, capped at 4 s. It ends 0.3 s
//    after the ringdown has died away (amplitude < 10⁻³; the innermost orbit for two neutron stars).
//  - The same window, placed at the aligned merger, trims the data and the model-over-data clips.
//  - Pitch: heavy binaries peak below what small speakers carry. When the model's loudest moment is below 120 Hz the
//    default is pitch ×4 (every frequency × 4, timing and envelope unchanged: amp · cos(4 · phase)); the true pitch
//    stays as a button. Stated on the card.
//  - Loudness: scaled so the loudest 50 ms has the same RMS for every event (peak capped), with 30 ms fades.

import { modelChirp, type ModelChirp, type ModelInput } from './model.ts';

export const LISTEN = {
  /** Where the model enters the band (Hz). */
  fEnter: 20,
  /** Longest lead before the merger (s): black-hole pairs, pairs with a neutron star. */
  leadBbh: 1.5,
  leadNs: 4,
  /** Kept after the ringdown has died away (s). */
  after: 0.3,
  /** Pitch ×4 when the model's loudest moment is below this (Hz). */
  shiftBelow: 120,
  shift: 4,
  fs: 16384,
  fade: 0.03,
  /** RMS of the loudest 50 ms, and the peak cap. */
  rms: 0.32,
  peak: 0.92,
} as const;

export interface ListenWindow {
  /** Model time (s; 0 = merger) of the first and last sample. */
  from: number;
  to: number;
}

/** The model used for listening: starts at 20 Hz, or the lead cap. */
export function listenModel(p: ModelInput, withNs: boolean): ModelChirp {
  return modelChirp(p, { fMin: LISTEN.fEnter, maxDuration: withNs ? LISTEN.leadNs : LISTEN.leadBbh, tail: 0.3 });
}

export function listenWindow(m: ModelChirp): ListenWindow {
  // End of the ringdown: last sample above 10⁻³ of the peak (amp is peak 1).
  let iEnd = m.amp.length - 1;
  while (iEnd > 0 && m.amp[iEnd]! < 1e-3) iEnd--;
  const tEnd = Math.max(0, m.t0 + iEnd / m.fs);
  return { from: m.t0, to: tEnd + LISTEN.after };
}

/** Gravitational-wave frequency (Hz) at the model's loudest moment. */
export function peakFrequency(m: ModelChirp): number {
  let ip = 0;
  for (let i = 1; i < m.amp.length; i++) if (m.amp[i]! > m.amp[ip]!) ip = i;
  return m.f[ip]!;
}

/** Default pitch factor: ×4 for chirps that peak below 120 Hz, else 1. */
export const autoPitch = (m: ModelChirp): number => (peakFrequency(m) < LISTEN.shiftBelow ? LISTEN.shift : 1);

/**
 * The listening clip: amp · cos(pitch · phase) over the window at 16384 Hz, faded, loudness-normalised. Sample 0 is
 * at model time `win.from`.
 */
export function listenClip(m: ModelChirp, win: ListenWindow, pitch = 1, fs: number = LISTEN.fs): Float32Array {
  const n = Math.max(2, Math.round((win.to - win.from) * fs));
  const out = new Float32Array(n);
  const last = m.amp.length - 1;
  for (let j = 0; j < n; j++) {
    const x = (win.from + j / fs - m.t0) * m.fs;
    const i = Math.floor(x);
    if (i < 0 || i >= last) continue;
    const u = x - i;
    const a = m.amp[i]! + (m.amp[i + 1]! - m.amp[i]!) * u;
    const ph = m.phase[i]! + (m.phase[i + 1]! - m.phase[i]!) * u;
    out[j] = a * Math.cos(pitch * ph);
  }
  fadeEnds(out, fs, LISTEN.fade);
  normaliseLoudness(out, fs);
  return out;
}

/** Raised-cosine fades at both ends, in place. */
export function fadeEnds(x: Float32Array, fs: number, fade: number): Float32Array {
  const k = Math.min(Math.floor(x.length / 2), Math.round(fade * fs));
  for (let j = 0; j < k; j++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * j) / k);
    x[j] = x[j]! * g;
    x[x.length - 1 - j] = x[x.length - 1 - j]! * g;
  }
  return x;
}

/** RMS of the loudest `win` seconds. */
export function loudestRms(x: ArrayLike<number>, fs: number, win = 0.05): number {
  const w = Math.max(1, Math.min(x.length, Math.round(win * fs)));
  let s = 0;
  for (let j = 0; j < w; j++) s += x[j]! * x[j]!;
  let best = s;
  for (let j = w; j < x.length; j++) {
    s += x[j]! * x[j]! - x[j - w]! * x[j - w]!;
    if (s > best) best = s;
  }
  return Math.sqrt(Math.max(0, best) / w);
}

/** Scale so the loudest 50 ms has RMS LISTEN.rms, peak no higher than LISTEN.peak. In place; returns the factor. */
export function normaliseLoudness(x: Float32Array, fs: number): number {
  const r = loudestRms(x, fs);
  let peak = 0;
  for (let j = 0; j < x.length; j++) peak = Math.max(peak, Math.abs(x[j]!));
  if (!(r > 0) || !(peak > 0)) return 1;
  const k = Math.min(LISTEN.rms / r, LISTEN.peak / peak);
  for (let j = 0; j < x.length; j++) x[j] = x[j]! * k;
  return k;
}

/**
 * Trim samples (sample 0 at `t0`, rate `fs`) to [from, to] (same clock), with short fades: the data and the
 * model-over-data clips, cut to the listening window around the aligned merger. Returns the samples and the time of
 * the first one.
 */
export function trimTo(x: ArrayLike<number>, t0: number, fs: number, from: number, to: number, fade: number = LISTEN.fade): { data: Float32Array; t0: number } {
  const i0 = Math.max(0, Math.min(x.length - 2, Math.round((from - t0) * fs)));
  const i1 = Math.max(i0 + 2, Math.min(x.length, Math.round((to - t0) * fs) + 1));
  const data = Float32Array.from({ length: i1 - i0 }, (_, j) => x[i0 + j]!);
  return { data: fadeEnds(data, fs, fade), t0: t0 + i0 / fs };
}
