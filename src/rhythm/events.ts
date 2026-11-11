// Onsets in a window of ticks. Windows are half-open [t0, t1) on the integer tick grid, so consecutive windows
// never overlap or leave gaps. Output goes into a preallocated buffer, sorted by tick. Pure.

import type { Compiled } from './pattern.ts';

export interface OnsetBuffer {
  n: number;
  tick: Float64Array;
  layer: Uint8Array;
  /** Step within the layer cycle. */
  step: Int32Array;
  /** 1 hit, 2 accent. */
  accent: Uint8Array;
  /** Number of layers hitting on this tick (1 = alone). */
  together: Uint8Array;
}

export function createOnsetBuffer(cap = 1024): OnsetBuffer {
  return {
    n: 0,
    tick: new Float64Array(cap),
    layer: new Uint8Array(cap),
    step: new Int32Array(cap),
    accent: new Uint8Array(cap),
    together: new Uint8Array(cap),
  };
}

/** Appends onsets of the masked layers with t0 ≤ tick < t1 (ticks relative to the section anchor). Returns the count added. */
export function onsetsInTicks(c: Compiled, mask: number, t0: number, t1: number, out: OnsetBuffer): number {
  const start = out.n;
  const cap = out.tick.length;
  const L = c.steps.length;
  for (let i = 0; i < L; i++) {
    if (!(mask & (1 << i))) continue;
    const ts = c.tickStep[i]!;
    const n = c.steps[i]!;
    const hits = c.section.layers[i]!.hits;
    for (let k = Math.ceil(t0 / ts); k * ts < t1; k++) {
      const st = ((k % n) + n) % n;
      const h = hits[st]!;
      if (!h) continue;
      if (out.n >= cap) break;
      // Insertion keeps the buffer sorted by tick, then layer.
      const tick = k * ts;
      let j = out.n++;
      while (j > start && out.tick[j - 1]! > tick) {
        out.tick[j] = out.tick[j - 1]!;
        out.layer[j] = out.layer[j - 1]!;
        out.step[j] = out.step[j - 1]!;
        out.accent[j] = out.accent[j - 1]!;
        j--;
      }
      out.tick[j] = tick;
      out.layer[j] = i;
      out.step[j] = st;
      out.accent[j] = h;
    }
  }
  // Coincidences.
  for (let a = start; a < out.n; ) {
    let b = a + 1;
    while (b < out.n && out.tick[b] === out.tick[a]) b++;
    for (let k = a; k < b; k++) out.together[k] = b - a;
    a = b;
  }
  return out.n - start;
}

/** First tick at or after a position (master cycles) for a section anchored at `anchor`. */
export const tickAtPos = (c: Compiled, anchor: number, pos: number) => Math.ceil((pos - anchor) * c.G - 1e-6);

export const posOfTick = (c: Compiled, anchor: number, tick: number) => anchor + tick / c.G;
