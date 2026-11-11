// Euclidean rhythms: k onsets spread as evenly as possible over n steps, by Bjorklund's algorithm in the ordering
// Toussaint (2005) uses, so E(3,8) is the tresillo [x . . x . . x .]. Pure.

export function bjorklund(k: number, n: number): Uint8Array {
  if (!Number.isInteger(k) || !Number.isInteger(n) || n <= 0 || k < 0) throw new Error(`bjorklund(${k}, ${n})`);
  const out = new Uint8Array(n);
  if (k >= n) return out.fill(1);
  if (k === 0) return out;
  let a: number[][] = Array.from({ length: k }, () => [1]);
  let b: number[][] = Array.from({ length: n - k }, () => [0]);
  while (b.length > 1) {
    const m = Math.min(a.length, b.length);
    const joined = a.slice(0, m).map((x, i) => x.concat(b[i]!));
    const rest = a.length > m ? a.slice(m) : b.slice(m);
    a = joined;
    b = rest;
  }
  let i = 0;
  for (const g of a.concat(b)) for (const v of g) out[i++] = v;
  return out;
}

/** Rotate left by r steps (the onset at step r moves to step 0). */
export function rotate(p: ArrayLike<number>, r: number): Uint8Array {
  const n = p.length;
  const out = new Uint8Array(n);
  const s = ((Math.round(r) % n) + n) % n;
  for (let i = 0; i < n; i++) out[i] = p[(i + s) % n]!;
  return out;
}

/** Onset positions of a pattern. */
export function onsets(p: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < p.length; i++) if (p[i]) out.push(i);
  return out;
}

/** Inter-onset intervals, cyclic: E(3,8) → [3, 3, 2]. */
export function intervals(p: ArrayLike<number>): number[] {
  const on = onsets(p);
  return on.map((s, i) => (i + 1 < on.length ? on[i + 1]! : on[0]! + p.length) - s);
}

/** Box notation used in the copy and tests: [1,0,0,1] → "x..x". */
export const box = (p: ArrayLike<number>) => Array.from(p, (v) => (v ? 'x' : '.')).join('');
