// The noise landscape (stages 9–10): Hanford's three seconds around GW150914 as a time × frequency × amplitude
// terrain. Built in init() from two measured inputs: the raw strain (raw-H1) and its ASD over the full 32 s
// (asd-H1, Welch, from scripts/fetch-gwosc.py).
//
//   whitened series   w(t)    = raw strain ÷ ASD in the frequency domain (15–1000 Hz), unit σ (spectro.ts whiten)
//   whitened terrain  |W(t,f)|² = its short-time power (62.5 ms Hann windows) over each frequency's median: noise ≈ 1
//   raw terrain       ASD(f) · |W(t,f)| = the raw data's short-time spectrum (the ASD put back in)
//
// The raw terrain is drawn from the whitened one with the ASD multiplied back, because a direct short-time spectrum
// of the raw strain would be swamped by leakage from the enormous seismic motion below 10 Hz. Both are the same data.

import { asdBandPeak, asdBandRms, logFreqs, spectrogram, whiten, type Asd } from './spectro.ts';

export interface LandscapeOptions {
  fLo?: number;
  fHi?: number;
  cols?: number;
  rows?: number;
  tFrom?: number;
  tTo?: number;
  /** Window length, samples. */
  win?: number;
  /** World extents of the field: width (log-frequency axis), depth (time axis). */
  width?: number;
  depth?: number;
  /** Height per decade of the raw spectrum, and per unit of whitened power (|W|²). */
  rawPerDecade?: number;
  whitePerPower?: number;
}

export interface Landscape {
  rows: number;
  cols: number;
  freqs: Float32Array;
  times: Float32Array;
  /** Column x and row z (world, centred). */
  x: Float32Array;
  z: Float32Array;
  /** Heights: raw (log ASD · |W|) and whitened (|W|²) terrains. */
  hRaw: Float32Array;
  hWhite: Float32Array;
  /** Excess-power weights for the whitened terrain (0 in noise, → 1 on the chirp). */
  hotWhite: Float32Array;
  /** The ASD per column: band rms and peak (lines). */
  asdRms: Float32Array;
  asdPeak: Float32Array;
  /** Height of an ASD value on the raw scale. */
  heightOfAsd(a: number): number;
  /** World x of a frequency, world z of a time. */
  xOf(f: number): number;
  zOf(t: number): number;
  /** Lowest ASD in the band (the floor of the raw scale). */
  floor: number;
  /** Whitened series used (unit σ), same time axis as the raw input. */
  white: Float32Array;
}

export function buildLandscape(raw: ArrayLike<number>, fs: number, t0: number, asd: Asd, o: LandscapeOptions = {}): Landscape {
  const fLo = o.fLo ?? 15;
  const fHi = o.fHi ?? 1000;
  const cols = o.cols ?? 120;
  const rows = o.rows ?? 96;
  const tFrom = o.tFrom ?? -1.25;
  const tTo = o.tTo ?? 0.25;
  const win = o.win ?? 256;
  const width = o.width ?? 6;
  const depth = o.depth ?? 4.5;
  const perDec = o.rawPerDecade ?? 0.55;
  const perPow = o.whitePerPower ?? 0.035;

  const white = whiten(raw, fs, asd, fLo, fHi);
  const freqs = logFreqs(fLo, fHi, cols);
  const times = new Float32Array(rows);
  for (let r = 0; r < rows; r++) times[r] = tFrom + ((tTo - tFrom) * r) / (rows - 1);
  const sp = spectrogram(white, fs, t0, times, freqs, win, 1024);

  const asdRms = new Float32Array(cols);
  const asdPeak = new Float32Array(cols);
  const ratio = Math.pow(fHi / fLo, 1 / (cols - 1));
  let floor = Infinity;
  for (let c = 0; c < cols; c++) {
    const f = freqs[c]!;
    const lo = f / Math.sqrt(ratio);
    const hi = f * Math.sqrt(ratio);
    asdRms[c] = asdBandRms(asd, lo, hi);
    asdPeak[c] = asdBandPeak(asd, lo, hi);
    floor = Math.min(floor, asdRms[c]!);
  }
  const lf = Math.log10(floor);
  const heightOfAsd = (a: number) => Math.max(0, (Math.log10(Math.max(a, 1e-30)) - lf) * perDec);
  const xOf = (f: number) => (Math.log(f / fLo) / Math.log(fHi / fLo) - 0.5) * width;
  // Latest rows nearest the viewer (+z).
  const zOf = (t: number) => ((t - tFrom) / (tTo - tFrom) - 0.5) * depth;
  const x = new Float32Array(cols);
  for (let c = 0; c < cols; c++) x[c] = xOf(freqs[c]!);
  const z = new Float32Array(rows);
  for (let r = 0; r < rows; r++) z[r] = zOf(times[r]!);
  const hRaw = new Float32Array(rows * cols);
  const hWhite = new Float32Array(rows * cols);
  const hotWhite = new Float32Array(rows * cols);
  // The 32 s ASD does not flatten these 3 s perfectly (the noise drifts): the whitened terrain is also divided by
  // each frequency's median power over the window, so noise sits at 1 everywhere and only excess stands up.
  const col = new Float32Array(rows);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) col[r] = sp.mag[r * cols + c]! ** 2;
    col.sort();
    const med = col[rows >> 1]! || 1;
    for (let r = 0; r < rows; r++) {
      const k = r * cols + c;
      const m = sp.mag[k]!;
      hRaw[k] = heightOfAsd(asdRms[c]! * m);
      const p = (m * m) / med;
      hWhite[k] = p * perPow;
      hotWhite[k] = Math.min(1, Math.max(0, (p - 10) / 30));
    }
  }
  return { rows, cols, freqs, times, x, z, hRaw, hWhite, hotWhite, asdRms, asdPeak, heightOfAsd, xOf, zOf, floor, white };
}
