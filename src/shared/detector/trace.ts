// Waveform helpers for drawing data series as luminous lines (pure arithmetic; no three). A trace keeps its points in
// data space, x = seconds, y = series value × gain, so a Lines state transform (sx, sy, x, y) places and zooms it.

/** Points (x = t, y = value · gain) of a uniformly sampled series between tFrom and tTo, every `step` samples. */
export function tracePoints(arr: ArrayLike<number>, t0: number, fs: number, tFrom: number, tTo: number, gain = 1, step = 1, sign = 1, shift = 0): Float32Array {
  const i0 = Math.max(0, Math.ceil((tFrom - shift - t0) * fs));
  const i1 = Math.min(arr.length - 1, Math.floor((tTo - shift - t0) * fs));
  const n = Math.max(0, Math.floor((i1 - i0) / step) + 1);
  const out = new Float32Array(n * 2);
  for (let k = 0; k < n; k++) {
    const i = i0 + k * step;
    out[k * 2] = t0 + i / fs + shift;
    out[k * 2 + 1] = arr[i]! * gain * sign;
  }
  return out;
}

/** Linear interpolation into a uniformly sampled series (clamped). */
export function sampleSeries(arr: ArrayLike<number>, t0: number, fs: number, t: number): number {
  const n = arr.length;
  if (!n) return 0;
  const x = (t - t0) * fs;
  if (x <= 0) return arr[0]!;
  if (x >= n - 1) return arr[n - 1]!;
  const i = Math.floor(x);
  const u = x - i;
  return arr[i]! * (1 - u) + arr[i + 1]! * u;
}

/** Fraction (0–1) of a trace built over [tFrom, tTo] at which time t sits: the `to` of a reveal that ends at t. */
export const traceFraction = (t: number, tFrom: number, tTo: number): number => Math.min(1, Math.max(0, (t - tFrom) / (tTo - tFrom)));

/**
 * Pre-formatted label strings for a quantity shown live (no string building in the frame loop): values from lo to
 * hi in `steps` steps, each formatted once.
 */
export class LabelTable {
  private readonly texts: string[];
  constructor(
    private readonly lo: number,
    private readonly hi: number,
    steps: number,
    format: (v: number) => string,
  ) {
    this.texts = Array.from({ length: steps + 1 }, (_, i) => format(lo + ((hi - lo) * i) / steps));
  }
  get(v: number): string {
    const n = this.texts.length - 1;
    const i = Math.round(((v - this.lo) / (this.hi - this.lo)) * n);
    return this.texts[i < 0 ? 0 : i > n ? n : i]!;
  }
}

/** "1.23 × 10⁻¹⁸" style with HTML superscript. */
export function sci(v: number, digits = 2, unit = ''): string {
  if (v === 0) return `0${unit ? ' ' + unit : ''}`;
  const e = Math.floor(Math.log10(Math.abs(v)));
  const m = v / 10 ** e;
  const exp = e < 0 ? `−${-e}` : String(e);
  return `${m.toFixed(digits)} × 10<sup>${exp}</sup>${unit ? ' ' + unit : ''}`;
}
