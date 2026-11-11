// Spectral tools for the noise and finding stages (pure: no DOM, no three). Small enough to run in a scene's init():
// an in-place radix-2 FFT, whitening of a strain series by a measured ASD, and a short-time spectrum resampled onto
// log-spaced frequency columns. The heavy, published processing (Welch PSD over 32 s, matched filter) ran at build
// time in scripts/fetch-gwosc.py; this only re-expresses the same data for drawing.

/** In-place complex FFT (radix 2; length a power of two). inverse = true computes the unnormalised inverse. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]!;
      re[i] = re[j]!;
      re[j] = t;
      t = im[i]!;
      im[i] = im[j]!;
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b]! * cr - im[b]! * ci;
        const xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

export const nextPow2 = (n: number): number => 1 << Math.ceil(Math.log2(Math.max(1, n)));

/** A measured amplitude spectral density on a uniform frequency grid: value(f) = data[(f − f0) / df]. */
export interface Asd {
  f0: number;
  df: number;
  data: ArrayLike<number>;
}

/** ASD at f (linear interpolation; 0 outside the grid). */
export function asdAt(a: Asd, f: number): number {
  const x = (f - a.f0) / a.df;
  if (x < 0 || x > a.data.length - 1) return 0;
  const i = Math.floor(x);
  const u = x - i;
  return a.data[i]! * (1 - u) + (a.data[Math.min(i + 1, a.data.length - 1)] ?? 0) * u;
}

/** Root-mean-square of the ASD over [fLo, fHi] (the band a drawing column covers), on the ASD's own grid. */
export function asdBandRms(a: Asd, fLo: number, fHi: number): number {
  const i0 = Math.max(0, Math.floor((fLo - a.f0) / a.df));
  const i1 = Math.min(a.data.length - 1, Math.ceil((fHi - a.f0) / a.df));
  let s = 0;
  let n = 0;
  for (let i = i0; i <= i1; i++) {
    s += a.data[i]! * a.data[i]!;
    n++;
  }
  return n ? Math.sqrt(s / n) : 0;
}

/** Largest ASD value over [fLo, fHi] (peak hold: keeps narrow lines such as 60 Hz visible in a wide column). */
export function asdBandPeak(a: Asd, fLo: number, fHi: number): number {
  const i0 = Math.max(0, Math.floor((fLo - a.f0) / a.df));
  const i1 = Math.min(a.data.length - 1, Math.ceil((fHi - a.f0) / a.df));
  let m = 0;
  for (let i = i0; i <= i1; i++) m = Math.max(m, a.data[i]!);
  return m;
}

/**
 * Whiten a strain series by the ASD: Tukey window, FFT, divide each bin by ASD(f), keep fLo–fHi, inverse FFT, then
 * normalise to unit standard deviation over the whole series. The result is in units of the noise σ, like the
 * published whitened series, but over a wider band (for the landscape).
 */
export function whiten(x: ArrayLike<number>, fs: number, asd: Asd, fLo: number, fHi: number, alpha = 0.1): Float32Array {
  const n = x.length;
  const N = nextPow2(n);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const edge = Math.max(1, Math.floor((alpha * n) / 2));
  for (let i = 0; i < n; i++) {
    let w = 1;
    if (i < edge) w = 0.5 * (1 - Math.cos((Math.PI * i) / edge));
    else if (i >= n - edge) w = 0.5 * (1 - Math.cos((Math.PI * (n - 1 - i)) / edge));
    re[i] = x[i]! * w;
  }
  fft(re, im);
  for (let k = 0; k < N; k++) {
    const kk = k <= N / 2 ? k : N - k;
    const f = (kk * fs) / N;
    const a = asdAt(asd, f);
    // Soft band edges (8 % of the edge frequency) so the band-limit does not ring.
    const lo = Math.min(1, Math.max(0, (f - fLo) / (0.08 * fLo)));
    const hi = Math.min(1, Math.max(0, (fHi - f) / (0.08 * fHi)));
    const g = a > 0 ? (lo * hi) / a : 0;
    re[k] = re[k]! * g;
    im[k] = im[k]! * g;
  }
  fft(re, im, true);
  const out = new Float32Array(n);
  let s = 0;
  for (let i = edge; i < n - edge; i++) s += (re[i]! / N) ** 2;
  const sd = Math.sqrt(s / Math.max(1, n - 2 * edge)) || 1;
  for (let i = 0; i < n; i++) out[i] = re[i]! / N / sd;
  return out;
}

/** n log-spaced frequencies from f0 to f1 (inclusive). */
export function logFreqs(f0: number, f1: number, n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = f0 * Math.pow(f1 / f0, i / (n - 1));
  return out;
}

export interface Spectrogram {
  /** Centre time of each row (s, the series' own time axis). */
  times: Float32Array;
  freqs: Float32Array;
  /** rows × cols magnitudes, row-major. */
  mag: Float32Array;
  rows: number;
  cols: number;
}

/**
 * Short-time spectrum of x (Hann window of `win` samples, zero-padded to `nfft`), rows centred at the given times,
 * magnitudes interpolated at the given frequencies and normalised so that white noise of unit σ reads ≈ 1.
 */
export function spectrogram(x: ArrayLike<number>, fs: number, t0: number, times: ArrayLike<number>, freqs: ArrayLike<number>, win: number, nfft = nextPow2(win)): Spectrogram {
  const rows = times.length;
  const cols = freqs.length;
  const mag = new Float32Array(rows * cols);
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  const w = new Float64Array(win);
  let w2 = 0;
  for (let i = 0; i < win; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (win - 1)));
    w2 += w[i]! * w[i]!;
  }
  // |X_k| of unit-σ white noise has mean square Σw²; dividing by its root gives ≈ 1.
  const norm = 1 / Math.sqrt(w2);
  const binHz = fs / nfft;
  for (let r = 0; r < rows; r++) {
    re.fill(0);
    im.fill(0);
    const c = Math.round((times[r]! - t0) * fs);
    const s0 = c - (win >> 1);
    for (let i = 0; i < win; i++) {
      const j = s0 + i;
      re[i] = j >= 0 && j < x.length ? x[j]! * w[i]! : 0;
    }
    fft(re, im);
    for (let k = 0; k < cols; k++) {
      const b = freqs[k]! / binHz;
      const i = Math.floor(b);
      const u = b - i;
      const m0 = Math.hypot(re[i]!, im[i]!);
      const m1 = Math.hypot(re[i + 1] ?? 0, im[i + 1] ?? 0);
      mag[r * cols + k] = (m0 * (1 - u) + m1 * u) * norm;
    }
  }
  return { times: Float32Array.from(times), freqs: Float32Array.from(freqs), mag, rows, cols };
}

/** Mean and standard deviation of a slice. */
export function stats(x: ArrayLike<number>, i0 = 0, i1 = x.length): { mean: number; sd: number; peak: number } {
  let s = 0;
  let s2 = 0;
  let p = 0;
  for (let i = i0; i < i1; i++) {
    s += x[i]!;
    s2 += x[i]! * x[i]!;
    p = Math.max(p, Math.abs(x[i]!));
  }
  const n = Math.max(1, i1 - i0);
  const mean = s / n;
  return { mean, sd: Math.sqrt(Math.max(0, s2 / n - mean * mean)), peak: p };
}
