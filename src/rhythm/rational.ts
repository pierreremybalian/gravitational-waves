// Integer and rational arithmetic for rhythm grids. Pure.

export function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) [a, b] = [b, a % b];
  return a;
}

export function lcm(a: number, b: number): number {
  if (!a || !b) return 0;
  return Math.abs((Math.round(a) / gcd(a, b)) * Math.round(b));
}

export function lcmAll(xs: readonly number[]): number {
  return xs.reduce((acc, x) => lcm(acc, x), 1);
}

/** A positive rational, always reduced. */
export interface Ratio {
  readonly n: number;
  readonly d: number;
}

export function ratio(n: number, d = 1): Ratio {
  if (!Number.isInteger(n) || !Number.isInteger(d) || n <= 0 || d <= 0) throw new Error(`ratio: positive integers only (${n}/${d})`);
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

export const ONE: Ratio = { n: 1, d: 1 };

/** Smallest rational that is an integer multiple of both a and b: lcm(n₁·d₂, n₂·d₁) / (d₁·d₂), reduced. */
export function lcmRatio(a: Ratio, b: Ratio): Ratio {
  return ratio(lcm(a.n * b.d, b.n * a.d), a.d * b.d);
}

export const value = (r: Ratio) => r.n / r.d;
