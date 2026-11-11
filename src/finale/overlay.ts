// The model chirp laid over an event's whitened data (pure: no DOM, no Web Audio). The catalogue snippets are
// whitened by each detector's measured noise and band-passed 30–350 Hz (Butterworth order 4, zero phase:
// scripts/fetch-catalog.py), so the model is put through the same kind of processing before it is compared or mixed:
//  - processModel: the model (in phase and in quadrature) divided by an analytic Advanced LIGO design ASD (Ajith 2011
//    fit; the event's own noise curve is not shipped) and shaped by the band-pass's zero-phase response, at the
//    snippet's 2048 Hz. Zero-phase throughout, so the model's merger stays at t = 0.
//  - alignModel: where the model's merger falls in the data. The catalogue time is not the merger at a given detector
//    (geocentre vs site, up to ~21 ms, and the snippet is cut to the nearest sample of a rounded GPS time), so the
//    model is slid over ±80 ms around it; each lag scores the target detector's matched-filter SNR (phase maximised)
//    plus the other detectors' best within their light-travel time, and the best lag wins; when that score is within
//    noise, the catalogue time is used.
//  - mixOverlay: the aligned, phase-matched model on the data's own time grid, and a mix (model on top, data under).

import { fft, nextPow2 } from '../shared/detector/spectro.ts';
import { DETECTORS, lightTravel, type Detector } from '../gw/units.ts';
import type { ModelChirp } from './model.ts';

export interface ProcessedModel {
  fs: number;
  /** Data time of sample 0 relative to the model's merger (s). */
  t0: number;
  /** Whitened, band-passed model in phase and in quadrature; |h + i·hq| peaks at 1. */
  h: Float32Array;
  hq: Float32Array;
  /** Time of the envelope's peak relative to the merger (s). */
  tPeak: number;
}

export interface Alignment {
  /** Data time (s from the catalogue time) of the model's merger. */
  offset: number;
  /** Phase (rad) that best matches the data: model = h·cos φ + hq·sin φ. */
  phi: number;
  /** Matched-filter SNR in the target detector at the chosen lag (data are in units of noise σ). */
  snr: number;
  /** Network score: √(target² + Σ each other detector's best within its light-travel time²). */
  network: number;
  /** True when the SNR was too low and the catalogue time was used. */
  fallback: boolean;
}

/** Light-travel time between two sites (s); 30 ms (more than any pair here) where a site is not tabulated (GEO600). */
export function travelTime(a: string, b: string): number {
  const da = DETECTORS[a as Detector['id']];
  const db = DETECTORS[b as Detector['id']];
  return da && db ? lightTravel(da, db) : 0.03;
}

export const BAND: readonly [number, number] = [30, 350];
export const SEARCH = 0.08;
/** Below this the peak is not distinguishable from the largest of ~330 noise lags (≈ 3.4 on average). */
export const MIN_SNR = 4.5;

/** Advanced LIGO design noise ASD shape (Ajith 2011, arXiv:1107.1267, eq. 4.7), arbitrary units. */
export function aligoAsd(f: number): number {
  const x = Math.max(f, 5) / 215;
  const x2 = x * x;
  const s = Math.pow(x, -4.14) - 5 / x2 + (111 * (1 - x2 + 0.5 * x2 * x2)) / (1 + 0.5 * x2);
  return Math.sqrt(Math.max(s, 1e-6));
}

/** Power response of a zero-phase (forward–backward) order-4 Butterworth band-pass. */
export function bandResponse(f: number, lo = BAND[0], hi = BAND[1]): number {
  if (f <= 0) return 0;
  return 1 / (1 + Math.pow(lo / f, 8)) / (1 + Math.pow(f / hi, 8));
}

export function processModel(m: ModelChirp, fsOut = 2048, pad = 0.12): ProcessedModel {
  const dec = Math.max(1, Math.round(m.fs / fsOut));
  const p = Math.round(pad * m.fs);
  const n = nextPow2(m.h.length + 2 * p);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  // Two real signals in one complex FFT: z = h + i·hq.
  for (let i = 0; i < m.h.length; i++) {
    re[p + i] = m.amp[i]! * Math.cos(m.phase[i]!);
    im[p + i] = m.amp[i]! * Math.sin(m.phase[i]!);
  }
  fft(re, im);
  for (let k = 0; k < n; k++) {
    const f = (Math.min(k, n - k) * m.fs) / n;
    const g = bandResponse(f) / aligoAsd(f);
    re[k] = re[k]! * g;
    im[k] = im[k]! * g;
  }
  fft(re, im, true);
  // Keep [merger-relative] m.t0 − pad … end + pad, decimated (the band is far below the new Nyquist).
  const len = Math.floor((m.h.length + 2 * p) / dec);
  const h = new Float32Array(len);
  const hq = new Float32Array(len);
  let peak = 0;
  let iPeak = 0;
  for (let j = 0; j < len; j++) {
    const a = re[j * dec]! / n;
    const b = im[j * dec]! / n;
    h[j] = a;
    hq[j] = b;
    const e = a * a + b * b;
    if (e > peak) {
      peak = e;
      iPeak = j;
    }
  }
  const k = peak > 0 ? 1 / Math.sqrt(peak) : 1;
  for (let j = 0; j < len; j++) {
    h[j] = h[j]! * k;
    hq[j] = hq[j]! * k;
  }
  const fs = m.fs / dec;
  const t0 = m.t0 - p / m.fs;
  return { fs, t0, h, hq, tPeak: t0 + iPeak / fs };
}

/** Matched-filter SNR (phase maximised) and best phase of the processed model against one detector's data, per lag. */
export interface SnrSeries {
  /** Merger time (s, data clock) of lag 0 and the lag step (s). */
  tFirst: number;
  dt: number;
  snr: Float64Array;
  phi: Float64Array;
}

/** Samples louder than this (σ) are gated (zeroed ±50 ms) before matching: glitches, not chirps. */
export const GATE = 20;

/**
 * Slide the processed model over whitened data (σ units, same fs, sample 0 at `dataT0`), the model's merger at every
 * sample within ±search of `centre`: SNR = |⟨d, h + i·hq⟩| / ‖h‖ over the overlap.
 */
export function snrSeries(data: ArrayLike<number>, dataT0: number, p: ProcessedModel, centre = 0, search = SEARCH): SnrSeries {
  const fs = p.fs;
  const nL = Math.round(search * fs);
  const d = Float32Array.from(data);
  const g = Math.round(0.05 * fs);
  for (let i = 0; i < data.length; i++) if (Math.abs(data[i]!) > GATE) d.fill(0, Math.max(0, i - g), Math.min(d.length, i + g + 1));
  const base = Math.round((p.t0 + centre - dataT0) * fs) - nL; // data index of model sample 0 at the first lag
  const snr = new Float64Array(2 * nL + 1);
  const phi = new Float64Array(2 * nL + 1);
  for (let L = 0; L <= 2 * nL; L++) {
    const s = base + L;
    const k0 = Math.max(0, -s);
    const k1 = Math.min(p.h.length, d.length - s);
    let c = 0;
    let cq = 0;
    let nn = 0;
    for (let k = k0; k < k1; k++) {
      const x = d[s + k]!;
      const a = p.h[k]!;
      c += x * a;
      cq += x * p.hq[k]!;
      nn += a * a;
    }
    snr[L] = nn > 0 ? Math.hypot(c, cq) / Math.sqrt(nn) : 0;
    phi[L] = Math.atan2(cq, c);
  }
  return { tFirst: dataT0 + base / fs - p.t0, dt: 1 / fs, snr, phi };
}

/** Largest value of a series within [t − w, t + w]. */
function maxNear(s: SnrSeries, t: number, w: number): number {
  const i0 = Math.max(0, Math.ceil((t - w - s.tFirst) / s.dt));
  const i1 = Math.min(s.snr.length - 1, Math.floor((t + w - s.tFirst) / s.dt));
  let m = 0;
  for (let i = i0; i <= i1; i++) m = Math.max(m, s.snr[i]!);
  return m;
}

/**
 * Where the model's merger falls in the target detector's data. Every lag within ±search of the catalogue time
 * scores the target's SNR there plus, for each other detector, its best SNR within the light-travel time between the
 * two sites (a signal reaches them at most that far apart): the best network score wins, refined to a fraction of a
 * sample on the target's own SNR. Falls back to the catalogue time when the score is within noise (about 3.5 per
 * detector for the best of ~330 noise lags) or the best lag is the edge of the search.
 */
export function alignModel(
  target: ArrayLike<number>,
  dataT0: number,
  p: ProcessedModel,
  others: { data: ArrayLike<number>; travel: number }[] = [],
  centre = 0,
  search = SEARCH,
): Alignment {
  const st = snrSeries(target, dataT0, p, centre, search);
  const so = others.map((o) => ({ s: snrSeries(o.data, dataT0, p, centre, search + o.travel + 0.002), w: o.travel + 0.001 }));
  let best = -1;
  let bestNet = 0;
  for (let i = 0; i < st.snr.length; i++) {
    const t = st.tFirst + i * st.dt;
    let net = st.snr[i]! * st.snr[i]!;
    for (const o of so) {
      const m = maxNear(o.s, t, o.w);
      net += m * m;
    }
    if (net > bestNet) {
      bestNet = net;
      best = i;
    }
  }
  const nL = (st.snr.length - 1) / 2;
  const netSnr = Math.sqrt(bestNet);
  // A best lag on the edge of the search is not a peak (the chirp would lie outside it): fall back too.
  const edge = best <= 1 || best >= st.snr.length - 2;
  if (best < 0 || edge || netSnr < MIN_SNR * Math.sqrt(1 + others.length)) return { offset: centre, phi: st.phi[nL]!, snr: st.snr[nL]!, network: netSnr, fallback: true };
  // Sub-sample peak of the target's SNR (parabola through the three lags around the best), when it is a local peak.
  let frac = 0;
  if (best > 0 && best < st.snr.length - 1) {
    const y0 = st.snr[best - 1]!;
    const y1 = st.snr[best]!;
    const y2 = st.snr[best + 1]!;
    const den = y0 - 2 * y1 + y2;
    if (den < 0 && y1 >= y0 && y1 >= y2) frac = Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den));
  }
  return { offset: st.tFirst + (best + frac) * st.dt, phi: st.phi[best]!, snr: st.snr[best]!, network: netSnr, fallback: false };
}

export interface Overlay {
  /** The aligned, phase-matched model on the data's grid (peak 1); zero where it has not started or has ended. */
  model: Float32Array;
  /** Data layer + model layer, sample for sample (both start at the data's first sample). */
  mix: Float32Array;
  /** Levels used: data × dataGain (then soft-limited), model × modelGain. */
  dataGain: number;
  modelGain: number;
}

/** Levels: the model clearly on top, the data's noise about 12 dB under the model's peak. */
export const MIX = { data: 0.22, model: 0.85, dataCeil: 0.45 };

/** Put the processed model on the data's time grid at an alignment (linear interpolation; sub-sample offsets kept). */
export function placeModel(n: number, dataT0: number, fs: number, p: ProcessedModel, a: Alignment, out = new Float32Array(n)): Float32Array {
  const c = Math.cos(a.phi);
  const s = Math.sin(a.phi);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const x = (dataT0 + i / fs - a.offset - p.t0) * p.fs;
    const j = Math.floor(x);
    if (j < 0 || j + 1 >= p.h.length) {
      out[i] = 0;
      continue;
    }
    const u = x - j;
    const h = p.h[j]! * (1 - u) + p.h[j + 1]! * u;
    const q = p.hq[j]! * (1 - u) + p.hq[j + 1]! * u;
    out[i] = h * c + q * s;
    peak = Math.max(peak, Math.abs(out[i]!));
  }
  if (peak > 0) for (let i = 0; i < n; i++) out[i] = out[i]! / peak;
  return out;
}

export function mixOverlay(data: ArrayLike<number>, dataT0: number, fs: number, p: ProcessedModel, a: Alignment): Overlay {
  const n = data.length;
  const model = placeModel(n, dataT0, fs, p, a);
  const mix = new Float32Array(n);
  const ceil = MIX.dataCeil;
  for (let i = 0; i < n; i++) {
    // Data soft-limited so a glitch cannot set the clip's level (the transport normalises the clip's peak).
    const d = ceil * Math.tanh((data[i]! * MIX.data) / ceil);
    mix[i] = d + model[i]! * MIX.model;
  }
  return { model, mix, dataGain: MIX.data, modelGain: MIX.model };
}
