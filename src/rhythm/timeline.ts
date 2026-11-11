// The committed score: which section plays from which musical position, and per-layer gain envelopes. Entries are
// only committed at or after the scheduling horizon, so anything the listener hears (and the picture shows) has
// already been decided. Pure.

import type { Compiled } from './pattern.ts';
import { MAX_LAYERS } from './pattern.ts';

export interface Entry {
  /** Position (master cycles) from which this entry applies. */
  atPos: number;
  /** Position of tick 0 for this section (layer cycles start here). */
  anchor: number;
  /** null = silence. */
  c: Compiled | null;
  /** Layers playing. */
  mask: number;
}

export class Timeline {
  private readonly ring: Entry[];
  private first = 0;
  private count = 0;

  constructor(cap = 32) {
    this.ring = Array.from({ length: cap }, () => ({ atPos: 0, anchor: 0, c: null, mask: 0 }));
  }

  private get cap() {
    return this.ring.length;
  }

  private at_(j: number): Entry {
    return this.ring[(this.first + j) % this.cap]!;
  }

  /** Commit an entry; atPos must not precede the last one (an entry at the same position replaces it). */
  commit(atPos: number, anchor: number, c: Compiled | null, mask: number): Entry {
    const last = this.last();
    if (last && atPos < last.atPos - 1e-12) throw new Error(`Timeline: commit at ${atPos} before ${last.atPos}`);
    let e: Entry;
    if (last && Math.abs(atPos - last.atPos) <= 1e-12) e = last;
    else {
      if (this.count === this.cap) {
        this.first = (this.first + 1) % this.cap;
        this.count--;
      }
      e = this.at_(this.count);
      this.count++;
    }
    e.atPos = atPos;
    e.anchor = anchor;
    e.c = c;
    e.mask = mask;
    return e;
  }

  /** The entry in force at pos (null before the first). */
  at(pos: number): Entry | null {
    for (let j = this.count - 1; j >= 0; j--) {
      const e = this.at_(j);
      if (pos >= e.atPos - 1e-12) return e;
    }
    return null;
  }

  /** The entry after e, if committed. */
  next(e: Entry): Entry | null {
    for (let j = 0; j < this.count - 1; j++) if (this.at_(j) === e) return this.at_(j + 1);
    return null;
  }

  last(): Entry | null {
    return this.count ? this.at_(this.count - 1) : null;
  }

  clear(): void {
    this.first = 0;
    this.count = 0;
  }
}

/**
 * Per-layer gain envelopes with Web Audio's setTargetAtTime law: v(t) = target + (v₀ − target)·e^{−(t − t₀)/τ}.
 * A short history per slot lets the picture read the envelope at the (earlier) audible time.
 */
export class GainTrack {
  private readonly H = 8;
  private readonly t0: Float64Array;
  private readonly v0: Float64Array;
  private readonly target: Float64Array;
  private readonly tau: Float64Array;
  private readonly n: Uint8Array;

  constructor(initial = 1) {
    const size = MAX_LAYERS * this.H;
    this.t0 = new Float64Array(size).fill(-Infinity);
    this.v0 = new Float64Array(size).fill(initial);
    this.target = new Float64Array(size).fill(initial);
    this.tau = new Float64Array(size).fill(0.01);
    this.n = new Uint8Array(MAX_LAYERS).fill(1);
  }

  private ev(j: number, t: number): number {
    const dt = t - this.t0[j]!;
    if (dt <= 0) return this.v0[j]!;
    return this.target[j]! + (this.v0[j]! - this.target[j]!) * Math.exp(-dt / this.tau[j]!);
  }

  at(slot: number, t: number): number {
    const base = slot * this.H;
    const n = this.n[slot]!;
    for (let j = n - 1; j >= 0; j--) if (t >= this.t0[base + j]! || j === 0) return this.ev(base + j, t);
    return this.v0[base]!;
  }

  targetOf(slot: number): number {
    return this.target[slot * this.H + this.n[slot]! - 1]!;
  }

  set(slot: number, target: number, tStart: number, tau: number): void {
    const base = slot * this.H;
    let n = this.n[slot]!;
    const v = this.at(slot, tStart);
    if (n === this.H) {
      // Drop the oldest.
      for (let j = 1; j < n; j++) {
        this.t0[base + j - 1] = this.t0[base + j]!;
        this.v0[base + j - 1] = this.v0[base + j]!;
        this.target[base + j - 1] = this.target[base + j]!;
        this.tau[base + j - 1] = this.tau[base + j]!;
      }
      n--;
    }
    this.t0[base + n] = tStart;
    this.v0[base + n] = v;
    this.target[base + n] = target;
    this.tau[base + n] = Math.max(1e-4, tau);
    this.n[slot] = n + 1;
  }

  reset(value: number): void {
    this.t0.fill(-Infinity);
    this.v0.fill(value);
    this.target.fill(value);
    this.n.fill(1);
  }
}
