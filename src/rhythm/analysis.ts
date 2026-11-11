// Readouts and geometry derived from rhythms: composite patterns, intervals, the torus knot, Lissajous figures,
// rolling polygons and tap scoring. Pure.

import { gcd, lcm } from './rational.ts';

/** Composite of p : q on the lcm grid: 3:2 → "x.xxx." hits at 0, 2, 3, 4 of 6. */
export function composite(counts: readonly number[]): { grid: number; hits: number[]; intervals: number[] } {
  const grid = counts.reduce((a, b) => lcm(a, b), 1);
  const set = new Set<number>();
  for (const n of counts) for (let k = 0; k < n; k++) set.add((k * grid) / n);
  const hits = [...set].sort((a, b) => a - b);
  const intervals = hits.map((h, i) => (i + 1 < hits.length ? hits[i + 1]! : grid) - h);
  return { grid, hits, intervals };
}

const NAMES: [number, number, string][] = [
  [1, 1, 'unison'],
  [2, 1, 'octave'],
  [3, 2, 'perfect fifth'],
  [4, 3, 'perfect fourth'],
  [5, 4, 'major third'],
  [6, 5, 'minor third'],
  [5, 3, 'major sixth'],
  [8, 5, 'minor sixth'],
  [7, 4, 'harmonic seventh'],
  [9, 8, 'major second'],
  [15, 8, 'major seventh'],
  [16, 15, 'minor second'],
  [7, 5, 'septimal tritone'],
  [3, 1, 'octave and a fifth'],
  [4, 1, 'two octaves'],
  [5, 2, 'octave and a major third'],
];

/** The interval two frequencies in ratio p : q make, in cents, with a name when it is a familiar just ratio. */
export function intervalOf(p: number, q: number): { cents: number; name: string | null; p: number; q: number } {
  const g = gcd(p, q);
  let a = p / g;
  let b = q / g;
  if (a < b) [a, b] = [b, a];
  const cents = 1200 * Math.log2(a / b);
  const hit = NAMES.find(([x, y]) => x === a && y === b);
  return { cents, name: hit ? hit[2] : null, p: a, q: b };
}

/** Bars until the layers of a polymeter all start together again: lengths in pulses → pulses. */
export const realignPulses = (lengths: readonly number[]) => lengths.reduce((a, b) => lcm(a, b), 1);

// ── The knot ────────────────────────────────────────────────────────────────────────────────────────────────────
// p : q drawn on a torus: the angle around the ring turns p times per bar and the angle around the tube q times.
// Layer p hits whenever the curve crosses the marker meridian (θ = 0); layer q whenever it crosses the outer equator
// (φ = 0). For coprime p, q the curve is the (p, q) torus knot (3:2 is the trefoil); with g = gcd(p, q) > 1 it is the
// (p/g, q/g) knot traced g times per bar.

export function torusPoint(p: number, q: number, s: number, R: number, r: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const th = 2 * Math.PI * p * s;
  const ph = 2 * Math.PI * q * s;
  const rr = R + r * Math.cos(ph);
  out[0] = rr * Math.cos(th);
  out[1] = r * Math.sin(ph);
  out[2] = rr * Math.sin(th);
  return out;
}

/** Fraction of a bar after which the knot closes. */
export const knotPeriod = (p: number, q: number) => 1 / gcd(p, q);

/** Lissajous figure of two tones in ratio p : q (the knot seen edge-on, and the oscilloscope picture of the interval). */
export function lissajous(p: number, q: number, s: number, phase = Math.PI / 2): [number, number] {
  return [Math.sin(2 * Math.PI * p * s + phase), Math.sin(2 * Math.PI * q * s)];
}

// ── Rolling polygons (Shapes view of a polymeter) ──────────────────────────────────────────────────────────────
// A regular n-gon with side L rolls to +x along y = 0, pivoting clockwise on a vertex; each landing is one pulse.
// After u pulses it has advanced u·L and turned u·(2π/n). Vertex j touches down at pulses j, j + n, j + 2n, …, so
// the marked vertex 0 lands every n pulses (at u = 0 it is the pivot at the origin).

export interface Rolled {
  cx: number;
  cy: number;
  /** Rotation (radians; rolling to +x turns clockwise, so it decreases). */
  angle: number;
  /** Vertex currently on the floor (the pivot). */
  pivot: number;
}

export function rollPolygon(n: number, L: number, u: number, out: Rolled = { cx: 0, cy: 0, angle: 0, pivot: 0 }): Rolled {
  const k = Math.floor(u);
  const f = u - k;
  const ext = (2 * Math.PI) / n;
  const a = L / 2 / Math.tan(Math.PI / n);
  // At rest after k pulses the pivot is vertex k at x = kL and the centre sits at pivot + (−L/2, apothem).
  const th = -f * ext;
  const dx = -L / 2;
  out.cx = k * L + dx * Math.cos(th) - a * Math.sin(th);
  out.cy = dx * Math.sin(th) + a * Math.cos(th);
  out.angle = -(k + f) * ext;
  out.pivot = ((k % n) + n) % n;
  return out;
}

/** World positions (x, y pairs) of a rolled polygon's vertices. */
export function polygonVertices(n: number, L: number, r: Rolled, out: Float32Array = new Float32Array(n * 2)): Float32Array {
  const Rc = L / (2 * Math.sin(Math.PI / n));
  for (let j = 0; j < n; j++) {
    const ang = -Math.PI / 2 + Math.PI / n + j * ((2 * Math.PI) / n) + r.angle;
    out[2 * j] = r.cx + Rc * Math.cos(ang);
    out[2 * j + 1] = r.cy + Rc * Math.sin(ang);
  }
  return out;
}

// ── Tap scoring ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface TapStats {
  n: number;
  /** Mean signed error, ms (positive = late). */
  mean: number;
  /** Standard deviation, ms. */
  sd: number;
}

/** Signed error (s) of a tap against the nearest onset of a strictly periodic grid: onsets at t0 + k·period. */
export function tapError(tap: number, t0: number, period: number): number {
  const k = Math.round((tap - t0) / period);
  return tap - (t0 + k * period);
}

export function tapStats(errorsS: readonly number[]): TapStats {
  const n = errorsS.length;
  if (!n) return { n: 0, mean: 0, sd: 0 };
  const mean = errorsS.reduce((a, b) => a + b, 0) / n;
  const v = errorsS.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { n, mean: mean * 1000, sd: Math.sqrt(v) * 1000 };
}
