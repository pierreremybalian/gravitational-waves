// Positions of the two bodies through the inspiral, driven by a waveform's own frequency and phase (pure). For
// GW150914 the track is the best-fit template (public/data/gw150914/template-freq.f32 / template-phase.f32, t = 0 at
// the H1 merger), so the orbit turns exactly with the chirp that is heard: orbital phase = half the wave's phase,
// orbital frequency = half the wave's frequency, separation from Kepler's law.
//
// Kepler stops being a good description in the last orbit: from PLUNGE seconds before the merger the separation is
// eased to zero (a drawing choice, labelled modelled); from t = 0 the bodies are one (merged = true) and the template's
// amplitude carries the ringdown.

import { relativeSpeed, schwarzschildRadius, separation } from './chirp.ts';
import { C } from './units.ts';

export interface Track {
  /** Time of sample 0 (s, 0 = merger). */
  t0: number;
  /** Samples per second. */
  fs: number;
  /** Gravitational-wave frequency, Hz. */
  f: ArrayLike<number>;
  /** Gravitational-wave phase, rad. */
  phase: ArrayLike<number>;
  /** Optional strain amplitude envelope (any unit). */
  amp?: ArrayLike<number>;
}

export interface BinaryParams {
  /** Component masses, M☉, in the same frame as the track's frequencies (detector frame for a template). */
  m1: number;
  m2: number;
  /** Remnant mass, M☉ (for its horizon radius). */
  mFinal?: number;
}

export interface BinaryState {
  t: number;
  /** Wave frequency, Hz; orbital frequency is half. */
  f: number;
  /** Orbital phase, rad (half the wave phase). */
  orbitPhase: number;
  /** Separation, m. */
  a: number;
  /** Relative speed as a fraction of c (Kepler; frozen at its last value during the plunge). */
  v: number;
  /** Positions about the centre of mass, m (orbit in the x–y plane). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Horizon (Schwarzschild) radii, m; rf is the remnant's. */
  r1: number;
  r2: number;
  rf: number;
  /** 0 while Kepler holds, rising to 1 over the plunge. */
  plunge: number;
  merged: boolean;
  /** Amplitude envelope at t (0 if the track has none). */
  amp: number;
}

/** Seconds before the merger over which the separation is eased from Kepler's value to zero. */
export const PLUNGE = 0.012;

export function createBinaryState(): BinaryState {
  return { t: 0, f: 0, orbitPhase: 0, a: 0, v: 0, x1: 0, y1: 0, x2: 0, y2: 0, r1: 0, r2: 0, rf: 0, plunge: 0, merged: false, amp: 0 };
}

/** Linear interpolation into a uniformly sampled series (clamped). */
export function sampleAt(arr: ArrayLike<number>, t0: number, fs: number, t: number): number {
  const n = arr.length;
  if (!n) return 0;
  const x = (t - t0) * fs;
  if (x <= 0) return arr[0]!;
  if (x >= n - 1) return arr[n - 1]!;
  const i = Math.floor(x);
  const u = x - i;
  return arr[i]! * (1 - u) + arr[i + 1]! * u;
}

const smooth = (s: number) => (s <= 0 ? 0 : s >= 1 ? 1 : s * s * (3 - 2 * s));

/** Fill `out` with the binary at data time t (no allocation). */
export function binaryAt(track: Track, p: BinaryParams, t: number, out: BinaryState = createBinaryState()): BinaryState {
  const M = p.m1 + p.m2;
  out.t = t;
  out.r1 = schwarzschildRadius(p.m1);
  out.r2 = schwarzschildRadius(p.m2);
  out.rf = schwarzschildRadius(p.mFinal ?? M);
  out.amp = track.amp ? sampleAt(track.amp, track.t0, track.fs, t) : 0;
  out.merged = t >= 0;
  const tq = Math.min(t, 0);
  const f = sampleAt(track.f, track.t0, track.fs, tq);
  out.f = sampleAt(track.f, track.t0, track.fs, t);
  out.orbitPhase = 0.5 * sampleAt(track.phase, track.t0, track.fs, tq);
  const plungeStart = -PLUNGE;
  const fp = sampleAt(track.f, track.t0, track.fs, plungeStart);
  out.plunge = smooth((tq - plungeStart) / PLUNGE);
  const aK = separation(M, t < plungeStart ? f : fp);
  out.v = relativeSpeed(M, t < plungeStart ? f : fp) / C;
  out.a = out.merged ? 0 : aK * (1 - out.plunge);
  const c = Math.cos(out.orbitPhase);
  const s = Math.sin(out.orbitPhase);
  const a1 = (out.a * p.m2) / M;
  const a2 = (out.a * p.m1) / M;
  out.x1 = a1 * c;
  out.y1 = a1 * s;
  out.x2 = -a2 * c;
  out.y2 = -a2 * s;
  return out;
}
