// The tempo map: musical position p (master cycles) as a function of transport time t (s). A ring of segments,
// each with constant or exponentially changing rate f(t) = f₀·e^{k(t−t₀)}, so
//   p(t) = p₀ + f₀(e^{kτ} − 1)/k   and its inverse   τ = ln(1 + k(p − p₀)/f₀)/k   (τ = t − t₀).
// Segments are only appended at the tail; the last one extends forever at constant rate. Position is continuous
// by construction, so every tempo change, even an instant step, keeps phase. Pure, allocation-free after construction.

const SMALL_K = 1e-9;

export class TempoMap {
  private readonly cap: number;
  private readonly t0: Float64Array;
  private readonly p0: Float64Array;
  private readonly f0: Float64Array;
  private readonly k: Float64Array;
  /** Index of the first segment (oldest retained) and count. */
  private first = 0;
  private count = 1;

  constructor(cap = 256, t = 0, p = 0, rate = 1) {
    if (!(rate > 0)) throw new Error('TempoMap: rate must be > 0');
    this.cap = cap;
    this.t0 = new Float64Array(cap);
    this.p0 = new Float64Array(cap);
    this.f0 = new Float64Array(cap);
    this.k = new Float64Array(cap);
    this.t0[0] = t;
    this.p0[0] = p;
    this.f0[0] = rate;
  }

  private idx(j: number): number {
    return (this.first + j) % this.cap;
  }

  private get tail(): number {
    return this.idx(this.count - 1);
  }

  /** Start time of the open-ended tail segment. */
  get tailTime(): number {
    return this.t0[this.tail]!;
  }

  get tailRate(): number {
    const i = this.tail;
    return this.f0[i]!;
  }

  /** Segment index containing t (searches from the tail; queries are near the present). */
  private seg(t: number): number {
    for (let j = this.count - 1; j > 0; j--) {
      const i = this.idx(j);
      if (t >= this.t0[i]!) return i;
    }
    return this.idx(0);
  }

  private segOfPos(p: number): number {
    for (let j = this.count - 1; j > 0; j--) {
      const i = this.idx(j);
      if (p >= this.p0[i]!) return i;
    }
    return this.idx(0);
  }

  posAt(t: number): number {
    const i = this.seg(t);
    const tau = t - this.t0[i]!;
    const f = this.f0[i]!;
    const k = this.k[i]!;
    if (Math.abs(k) < SMALL_K) return this.p0[i]! + f * tau;
    return this.p0[i]! + (f * Math.expm1(k * tau)) / k;
  }

  timeAt(p: number): number {
    const i = this.segOfPos(p);
    const dp = p - this.p0[i]!;
    const f = this.f0[i]!;
    const k = this.k[i]!;
    if (Math.abs(k) < SMALL_K) return this.t0[i]! + dp / f;
    const arg = (k * dp) / f;
    // A decelerating segment never reaches positions beyond its asymptote; such a segment always has a successor.
    if (arg <= -1) return Number.POSITIVE_INFINITY;
    return this.t0[i]! + Math.log1p(arg) / k;
  }

  rateAt(t: number): number {
    const i = this.seg(t);
    return this.f0[i]! * Math.exp(this.k[i]! * (t - this.t0[i]!));
  }

  /** Append a segment starting at t (≥ tailTime) with rate f and exponent k; a later segment replaces one at the same time. */
  private push(t: number, f: number, k: number): void {
    const tail = this.tail;
    if (t < this.t0[tail]! - 1e-12) throw new Error(`TempoMap: cannot rewrite the past (${t} < ${this.t0[tail]})`);
    const p = this.posAt(t);
    let i: number;
    if (t - this.t0[tail]! <= 1e-12) i = tail;
    else {
      if (this.count === this.cap) {
        this.first = (this.first + 1) % this.cap;
        this.count--;
      }
      i = this.idx(this.count);
      this.count++;
    }
    this.t0[i] = t;
    this.p0[i] = p;
    this.f0[i] = f;
    this.k[i] = k;
  }

  /** Constant rate f from time t on (instant, phase-continuous). */
  step(t: number, f: number): void {
    if (!(f > 0)) throw new Error('TempoMap: rate must be > 0');
    this.push(t, f, 0);
  }

  /** Exponential ramp from the rate at t0 to f1 at t1, constant afterwards. The tail rate holds until t0. */
  rampTo(t0: number, t1: number, f1: number): void {
    if (!(f1 > 0)) throw new Error('TempoMap: rate must be > 0');
    const f0 = this.rateAt(t0);
    if (t1 <= t0 || Math.abs(Math.log(f1 / f0)) < 1e-12) {
      this.step(Math.max(t0, this.tailTime), f1);
      return;
    }
    this.push(t0, f0, Math.log(f1 / f0) / (t1 - t0));
    this.push(t1, f1, 0);
  }

  /** Forget everything and restart at (t, p) with rate f. */
  reset(t: number, p: number, f: number): void {
    this.first = 0;
    this.count = 1;
    this.t0[0] = t;
    this.p0[0] = p;
    this.f0[0] = f;
    this.k[0] = 0;
  }
}

/** One step of a first-order slew in log-rate: f moves toward target with time constant tau over dt. */
export function slewLog(f: number, target: number, dt: number, tau: number): number {
  if (tau <= 0) return target;
  const a = 1 - Math.exp(-dt / tau);
  return Math.exp(Math.log(f) + (Math.log(target) - Math.log(f)) * a);
}
