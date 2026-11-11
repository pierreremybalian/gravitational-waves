// A model chirp from a catalogue event's best-fit parameters (pure). For most events the whitened data is mostly noise
// to the ear (SNR 8–15), so the finale can also play this sketch, always labelled "modelled":
//  - inspiral: the leading-order (Newtonian) chirp f(τ) for the detector-frame chirp mass 𝓜(1 + z), amplitude ∝ f^(2/3),
//    up to the gravitational-wave frequency of the innermost stable circular orbit of the total mass;
//  - merger: a quick sweep (a few milliseconds) from there to the remnant's ringing frequency;
//  - ringdown: a damped sinusoid at the fundamental (l = m = 2) quasi-normal mode of the remnant, from the Berti,
//    Cardoso & Will (2006) fit with a typical remnant spin of 0.69 (the catalogue publishes no remnant spin here).
//    Two neutron stars do not ring like a black hole: their chirp is cut off at the innermost orbit.
// It is not the fitted waveform (no spins, no higher modes, no post-Newtonian phase); it has the right masses, the
// right duration in band and the right pitch to within tens of per cent.

import { chirpMass, frequencyAt, timeToCoalescence } from '../gw/chirp.ts';
import { T_SUN } from '../gw/units.ts';

export interface ModelInput {
  /** Source-frame masses, M☉. */
  m1: number;
  m2: number;
  /** Remnant mass, M☉ (source frame), if published. */
  mFinal?: number | null;
  redshift?: number | null;
  /** Two neutron stars: no black-hole ringdown. */
  bns?: boolean;
}

export interface ModelChirp {
  fs: number;
  /** Time of sample 0 (s; 0 = the end of the inspiral, the model's merger). */
  t0: number;
  /** Strain shape, peak 1. */
  h: Float32Array;
  /** Gravitational-wave frequency (Hz) and phase (rad, 0 at the merger) per sample. */
  f: Float32Array;
  phase: Float32Array;
  /** Amplitude envelope, peak 1. */
  amp: Float32Array;
  /** Detector-frame chirp mass and total mass, M☉. */
  mcDet: number;
  mDet: number;
  fStart: number;
  fIsco: number;
  /** Ringdown frequency (Hz) and quality factor; 0 for two neutron stars. */
  fRing: number;
  q: number;
}

export const REMNANT_SPIN = 0.69;

/** GW frequency at the innermost stable circular orbit of total (detector-frame) mass M: c³ / (6^(3/2) π G M). */
export const fIsco = (M: number): number => 1 / (Math.pow(6, 1.5) * Math.PI * M * T_SUN);

/** Fundamental quasi-normal mode of a Kerr black hole of mass M (M☉) and spin a (Berti et al. 2006, Table VIII). */
export function ringdown(M: number, a: number): { f: number; q: number } {
  const f = (1.5251 - 1.1568 * Math.pow(1 - a, 0.1292)) / (2 * Math.PI * M * T_SUN);
  const q = 0.7 + 1.4187 * Math.pow(1 - a, -0.499);
  return { f, q };
}

export interface ModelOptions {
  fs?: number;
  /** Longest inspiral kept (s); the chirp then starts above `fMin`. */
  maxDuration?: number;
  /** Lowest frequency kept (Hz): roughly where the detectors' band starts. */
  fMin?: number;
  /** Seconds kept after the merger. */
  tail?: number;
}

export function modelChirp(p: ModelInput, o: ModelOptions = {}): ModelChirp {
  const fs = o.fs ?? 4096;
  const maxDur = o.maxDuration ?? 3;
  const fMin = o.fMin ?? 25;
  const tail = o.tail ?? 0.25;
  const z = Math.max(0, p.redshift ?? 0);
  const m1 = p.m1 * (1 + z);
  const m2 = p.m2 * (1 + z);
  const M = m1 + m2;
  const mc = chirpMass(m1, m2);
  const mf = (p.mFinal ?? 0.952 * (p.m1 + p.m2)) * (1 + z);
  const fI = fIsco(M);
  const tauI = timeToCoalescence(fI, mc);
  // Inspiral start: fMin, or later if that would take longer than maxDuration to reach the innermost orbit.
  const tauMin = timeToCoalescence(fMin, mc);
  const fStart = tauMin - tauI > maxDur ? frequencyAt(maxDur + tauI, mc) : Math.min(fMin, fI * 0.9);
  const tStart = -(timeToCoalescence(fStart, mc) - tauI);
  const rd = p.bns ? { f: 0, q: 0 } : ringdown(mf, REMNANT_SPIN);
  // Merger sweep from fI to the ringing frequency over half a cycle at fI (a drawing choice for the sketch).
  const sweep = p.bns ? 0 : 0.5 / fI;
  const n = Math.max(2, Math.ceil((tail - tStart) * fs));
  const h = new Float32Array(n);
  const f = new Float32Array(n);
  const ph = new Float32Array(n);
  const amp = new Float32Array(n);
  const taper = Math.min(0.05, -tStart / 4);
  let phase = 0;
  let iMerge = 0;
  for (let i = 0; i < n; i++) {
    const t = tStart + i / fs;
    let fi: number;
    let a: number;
    if (t <= 0) {
      fi = frequencyAt(tauI - t, mc);
      a = Math.pow(fi / fI, 2 / 3);
      iMerge = i;
    } else if (p.bns) {
      fi = fI;
      a = Math.exp(-t * fI * 4);
    } else if (t <= sweep) {
      const u = t / sweep;
      const s = u * u * (3 - 2 * u);
      fi = fI + (rd.f - fI) * s;
      a = 1 + 0.25 * Math.sin(Math.PI * u);
    } else {
      fi = rd.f;
      a = Math.exp((-Math.PI * rd.f * (t - sweep)) / rd.q);
    }
    if (t - tStart < taper) a *= 0.5 * (1 - Math.cos((Math.PI * (t - tStart)) / taper));
    if (i > 0) phase += (Math.PI * (fi + f[i - 1]!)) / fs;
    f[i] = fi;
    ph[i] = phase;
    amp[i] = a;
  }
  // Phase 0 at the merger; strain = amp · cos(phase); normalise to peak 1.
  const p0 = ph[iMerge]!;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    ph[i] = ph[i]! - p0;
    peak = Math.max(peak, amp[i]!);
  }
  for (let i = 0; i < n; i++) {
    amp[i] = amp[i]! / peak;
    h[i] = amp[i]! * Math.cos(ph[i]!);
  }
  return { fs, t0: tStart, h, f, phase: ph, amp, mcDet: mc, mDet: M, fStart, fIsco: fI, fRing: rd.f, q: rd.q };
}
